/**
 * Исполнение pipeline DISCOVER → FETCH → VERIFY → PARSE → CLASSIFY →
 * EXTRACT → VERSION → STORE → INDEX для зарегистрированного коннектора.
 *
 * Каждый шаг журналируется (ingestion_events); результат — ingestion_runs.
 * Provenance: каждый документ получает source_id + snapshot_id + checksum.
 */

import type { Db } from '@yabloko/data-access';
import {
  createRun,
  finishRun,
  logEvent,
  storeSnapshot,
  upsertDocument,
  updateSourceAfterRun,
  setSourceStatus,
  recordAlert
} from '@yabloko/data-access';
import { checkUrlAllowed, fetchPage, sha256 } from './http.js';
import { classifyDoc, extractLinks, extractPublished, extractText, extractTitle } from './parse.js';
import type { FetchPageFn } from './types.js';

export interface DiscoveredItem {
  url: string;
  depth: number;
}

export interface SourceConnector {
  sourceId: string;
  /** Стартовые URL (DISCOVER); дальнейшие ссылки находятся обходом (crawl). */
  discover: () => DiscoveredItem[] | Promise<DiscoveredItem[]>;
}

export interface PipelineOptions {
  mode: 'live' | 'fixture';
  registeredUrl: string;
  fetchPageFn?: FetchPageFn;
  maxPages?: number;
  crawlDepth?: number;
  now?: () => Date;
}

export interface PipelineResult {
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  discovered: number;
  fetched: number;
  stored: number;
  duplicates: number;
  newVersions: number;
  failures: number;
  detail: string;
}

export async function runPipeline(
  db: Db,
  connector: SourceConnector,
  opts: PipelineOptions
): Promise<PipelineResult> {
  const now = opts.now ?? (() => new Date());
  const started = now().toISOString();
  const runId = createRun(db, {
    source_id: connector.sourceId,
    connector: connector.sourceId,
    mode: opts.mode,
    started_at: started
  });
  const log = (stage: string, level: 'debug' | 'info' | 'warn' | 'error', msg: string) =>
    logEvent(db, runId, stage, level, msg);

  let discovered = 0;
  let fetched = 0;
  let stored = 0;
  let duplicates = 0;
  let newVersions = 0;
  let failures = 0;

  try {
    // ---- DISCOVER ----
    const queue = await connector.discover();
    discovered = queue.length;
    log('DISCOVER', 'info', `Стартовых URL: ${queue.length}`);

    const seen = new Set<string>();
    let lastContentSha: string | null = null;
    let consecutiveFailures = 0;

    while (queue.length > 0) {
      const item = queue.shift() as DiscoveredItem;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      if (seen.size > (opts.maxPages ?? 8)) break;

      const guard = checkUrlAllowed(item.url, opts.registeredUrl);
      if (!guard.ok) {
        log('FETCH', 'warn', `URL отклонён: ${item.url} — ${guard.reason}`);
        failures += 1;
        continue;
      }

      // ---- FETCH (+VERIFY выполняется внутри: статус, лимиты, редиректы) ----
      const res = await (opts.fetchPageFn ?? fetchPage)(item.url, opts.registeredUrl);
      if (res.outcome !== 'ok' || res.body === null) {
        failures += 1;
        consecutiveFailures += 1;
        log('FETCH', 'warn', `${item.url}: ${res.detail}`);
        if (consecutiveFailures >= 4) {
          log('FETCH', 'error', '4 неудачи подряд — остановка обхода');
          break;
        }
        continue;
      }
      consecutiveFailures = 0;
      fetched += 1;
      log('FETCH', 'info', `${item.url}: ${res.detail}, ${res.sizeBytes} байт`);

      // ---- VERIFY ----
      const contentSha = sha256(res.body);
      if (res.body.trim().length === 0) {
        log('VERIFY', 'warn', `Пустое содержимое: ${item.url}`);
        failures += 1;
        continue;
      }
      log('VERIFY', 'info', `sha256=${contentSha.slice(0, 16)}…, mime=${res.mime ?? '—'}`);

      // ---- PARSE ----
      const title = extractTitle(res.body);
      const published = extractPublished(res.body);
      const text = extractText(res.body);
      log('PARSE', 'info', `title="${title ?? '—'}" published=${published.date ?? '—'}`);

      // ---- EXTRACT (links нужны и для классификации) ----
      const links = extractLinks(res.body, res.finalUrl || item.url);

      // ---- CLASSIFY ----
      const docKind = classifyDoc(item.url, title, text, links.length);
      log('CLASSIFY', 'info', `doc_kind=${docKind}`);
      const extracted = {
        links_found: links.length,
        word_count: text.split(/\s+/).filter(Boolean).length,
        mime: res.mime,
        final_url: res.finalUrl,
        http_status: res.httpStatus,
        fetch_mode: opts.mode
      };
      log('EXTRACT', 'info', `links=${links.length} words=${extracted.word_count}`);

      // ---- VERSION + STORE (+ INDEX внутри) ----
      const ts = now().toISOString();
      const snapshotId = storeSnapshot(db, {
        source_id: connector.sourceId,
        url: item.url,
        fetched_at: ts,
        http_status: res.httpStatus ?? 200,
        content_sha256: contentSha,
        mime: res.mime,
        size_bytes: res.sizeBytes,
        body: res.body.slice(0, 200_000),
        fetch_mode: opts.mode,
        fetch_duration_ms: res.durationMs
      });
      const up = upsertDocument(db, {
        source_id: connector.sourceId,
        url: item.url,
        snapshot_id: snapshotId,
        content_sha256: contentSha,
        mime: res.mime,
        title,
        doc_kind: docKind,
        published_at: published.date,
        date_precision: published.precision,
        text_excerpt: text.slice(0, 1200),
        extracted,
        now: ts
      });
      if (up.duplicate) {
        duplicates += 1;
        log('STORE', 'info', `Дубликат (без изменений): ${up.docId}`);
      } else {
        stored += 1;
        if (up.newVersion) {
          newVersions += 1;
          log('STORE', 'info', `Новая версия ${up.version}: ${up.docId}`);
        } else {
          log('STORE', 'info', `Новый документ: ${up.docId} (${docKind})`);
        }
        if (['program', 'statement', 'decision', 'press_release'].includes(docKind)) {
          recordAlert(db, {
            type: 'NEW_PARTY_DOCUMENT',
            severity: 'info',
            title: `Новый документ источника «${connector.sourceId}»: ${title ?? item.url}`,
            entityType: 'source',
            entityId: connector.sourceId,
            payload: { doc_id: up.docId, doc_kind: docKind, url: item.url }
          });
        }
      }
      lastContentSha = contentSha;

      // ---- Обход: enqueue ссылок того же хоста (DISCOVER продолжается) ----
      if (item.depth < (opts.crawlDepth ?? 1)) {
        for (const link of links) {
          if (!seen.has(link)) queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    }

    const status: PipelineResult['status'] =
      fetched === 0 && failures > 0 ? 'failed' : failures > 0 ? 'partial' : 'ok';
    const detail = `discovered=${discovered} fetched=${fetched} stored=${stored} duplicates=${duplicates} newVersions=${newVersions} failures=${failures}`;
    finishRun(db, runId, {
      status,
      finished_at: now().toISOString(),
      attempts: fetched + failures,
      stats: { discovered, fetched, stored, duplicates, newVersions, failures },
      detail
    });
    log('DONE', status === 'ok' ? 'info' : 'warn', detail);

    if (status === 'failed') {
      setSourceStatus(db, connector.sourceId, 'failed');
      recordAlert(db, {
        type: 'SOURCE_FAILURE',
        severity: 'error',
        title: `Источник «${connector.sourceId}»: все загрузки не удались (${failures} ошибок)`,
        entityType: 'source',
        entityId: connector.sourceId,
        payload: { failures, fetched }
      });
    } else if (status === 'ok') {
      setSourceStatus(db, connector.sourceId, 'active');
      if (lastContentSha) {
        updateSourceAfterRun(db, {
          source_id: connector.sourceId,
          last_update: now().toISOString(),
          checksum: lastContentSha
        });
      }
    }
    return { runId, status, discovered, fetched, stored, duplicates, newVersions, failures, detail };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    finishRun(db, runId, {
      status: 'failed',
      finished_at: now().toISOString(),
      attempts: fetched + failures,
      detail
    });
    setSourceStatus(db, connector.sourceId, 'failed');
    recordAlert(db, {
      type: 'SOURCE_FAILURE',
      severity: 'error',
      title: `Источник «${connector.sourceId}»: сбой pipeline — ${detail}`,
      entityType: 'source',
      entityId: connector.sourceId
    });
    return {
      runId,
      status: 'failed',
      discovered,
      fetched,
      stored,
      duplicates,
      newVersions,
      failures,
      detail
    };
  }
}
