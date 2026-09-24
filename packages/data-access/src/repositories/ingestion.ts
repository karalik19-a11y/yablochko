import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Хранилище результатов ingestion: snapshots → documents → FTS index.
 * Дедупликация по (source_id, content_sha256); новое содержимое того же URL —
 * новая версия. Пронанс реализован в схеме: каждый документ ссылается
 * на source_id и snapshot_id с http_status.
 */

export interface StoreSnapshotInput {
  source_id: string;
  url: string;
  fetched_at: string;
  http_status: number;
  content_sha256: string;
  mime: string | null;
  size_bytes: number;
  body: string | null;
  fetch_mode: 'live' | 'fixture';
  fetch_duration_ms: number;
}

export function storeSnapshot(db: Db, input: StoreSnapshotInput): string {
  const snapshot_id = newId('snap');
  db.prepare(
    `INSERT INTO source_snapshots (snapshot_id, source_id, url, fetched_at, http_status,
      content_sha256, mime, size_bytes, body, fetch_mode, fetch_duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    snapshot_id,
    input.source_id,
    input.url,
    input.fetched_at,
    input.http_status,
    input.content_sha256,
    input.mime,
    input.size_bytes,
    input.body,
    input.fetch_mode,
    input.fetch_duration_ms,
    new Date().toISOString()
  );
  return snapshot_id;
}

export interface UpsertDocumentInput {
  source_id: string;
  url: string;
  snapshot_id: string;
  content_sha256: string;
  mime: string | null;
  title: string | null;
  doc_kind: string;
  published_at: string | null;
  date_precision: string | null;
  text_excerpt: string | null;
  extracted: Record<string, unknown>;
  now: string;
}

export interface UpsertDocumentResult {
  docId: string;
  duplicate: boolean;
  newVersion: boolean;
  version: number;
}

/**
 * Вставка документа с дедупликацией:
 *  - то же содержимое источника → обновляем last_seen_at (duplicate);
 *  - новое содержимое → новая строка; если по этому URL уже были версии —
 *    version = max(version)+1 (newVersion = true).
 */
export function upsertDocument(db: Db, input: UpsertDocumentInput): UpsertDocumentResult {
  const docId = `doc-${input.source_id}-${input.content_sha256.slice(0, 20)}`;

  const existingSame = db
    .prepare(`SELECT doc_id FROM documents WHERE source_id = ? AND content_hash = ?`)
    .get(input.source_id, input.content_sha256) as { doc_id: string } | undefined;
  if (existingSame) {
    db.prepare(`UPDATE documents SET last_seen_at = ?, snapshot_id = ? WHERE doc_id = ?`).run(
      input.now,
      input.snapshot_id,
      existingSame.doc_id
    );
    const v = db
      .prepare(`SELECT version FROM documents WHERE doc_id = ?`)
      .get(existingSame.doc_id) as { version: number };
    return { docId: existingSame.doc_id, duplicate: true, newVersion: false, version: Number(v.version) };
  }

  const prevVersionRow = db
    .prepare(`SELECT MAX(version) AS v FROM documents WHERE source_id = ? AND url = ?`)
    .get(input.source_id, input.url) as { v: number | null };
  const version = prevVersionRow.v === null ? 1 : Number(prevVersionRow.v) + 1;

  db.prepare(
    `INSERT INTO documents (doc_id, source_id, url, snapshot_id, fetched_at, content_hash,
       mime, title, doc_kind, published_at, date_precision, extracted_json, text_excerpt,
       last_seen_at, version, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?)`
  ).run(
    docId,
    input.source_id,
    input.url,
    input.snapshot_id,
    input.now,
    input.content_sha256,
    input.mime,
    input.title,
    input.doc_kind,
    input.published_at,
    input.date_precision,
    JSON.stringify(input.extracted),
    input.text_excerpt,
    input.now,
    version,
    input.now
  );

  indexDocument(db, {
    doc_id: docId,
    title: input.title,
    text_excerpt: input.text_excerpt
  });

  return { docId, duplicate: false, newVersion: version > 1, version };
}

/** INDEX stage: (пере)индексация документа в FTS. */
export function indexDocument(
  db: Db,
  doc: { doc_id: string; title: string | null; text_excerpt: string | null }
): void {
  db.prepare(`DELETE FROM documents_fts WHERE doc_id = ?`).run(doc.doc_id);
  db.prepare(`INSERT INTO documents_fts (doc_id, title, text_excerpt) VALUES (?, ?, ?)`).run(
    doc.doc_id,
    doc.title ?? '',
    doc.text_excerpt ?? ''
  );
}

export interface FtsHit {
  doc_id: string;
  title: string | null;
  snippet: string | null;
}

/** Поиск по FTS (безопасный MATCH: спецсимволы query вырезаются). */
export function searchDocuments(db: Db, query: string, limit = 20): FtsHit[] {
  const safe = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!safe) return [];
  const match = safe.split(/\s+/).map((w) => `${w}*`).join(' ');
  try {
    const rows = db
      .prepare(
        `SELECT d.doc_id AS doc_id, d.title AS title,
                snippet(documents_fts, 2, '…', '…', '…', 12) AS snippet
         FROM documents_fts f
         JOIN documents d ON d.doc_id = f.doc_id
         WHERE documents_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      doc_id: String(r.doc_id),
      title: r.title === null ? null : String(r.title),
      snippet: r.snippet === null ? null : String(r.snippet)
    }));
  } catch {
    return [];
  }
}

export interface SourceDocumentRow {
  doc_id: string;
  source_id: string;
  url: string;
  title: string | null;
  doc_kind: string | null;
  published_at: string | null;
  fetched_at: string | null;
  last_seen_at: string | null;
  content_hash: string | null;
  version: number;
  status: string;
  size_bytes: number | null;
  http_status: number | null;
  fetch_mode: string | null;
}

export function listSourceDocuments(
  db: Db,
  opts: { sourceId?: string; limit?: number; offset?: number } = {}
): { items: SourceDocumentRow[]; total: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.sourceId ? `WHERE d.source_id = ?` : '';
  const params: (string | number)[] = opts.sourceId ? [opts.sourceId] : [];

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM documents d ${where}`)
    .get(...params) as { n: number };

  const rows = db
    .prepare(
      `SELECT d.doc_id, d.source_id, d.url, d.title, d.doc_kind, d.published_at,
              d.fetched_at, d.last_seen_at, d.content_hash, d.version, d.status,
              s.size_bytes, s.http_status, s.fetch_mode
       FROM documents d
       LEFT JOIN source_snapshots s ON s.snapshot_id = d.snapshot_id
       ${where}
       ORDER BY COALESCE(d.last_seen_at, d.fetched_at) DESC, d.doc_id
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const items = rows.map((r) => ({
    doc_id: str(r.doc_id) ?? '',
    source_id: str(r.source_id) ?? '',
    url: str(r.url) ?? '',
    title: str(r.title),
    doc_kind: str(r.doc_kind),
    published_at: str(r.published_at),
    fetched_at: str(r.fetched_at),
    last_seen_at: str(r.last_seen_at),
    content_hash: str(r.content_hash),
    version: Number(r.version ?? 1),
    status: str(r.status) ?? 'NEW',
    size_bytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    http_status: r.http_status === null || r.http_status === undefined ? null : Number(r.http_status),
    fetch_mode: str(r.fetch_mode)
  }));
  return { items, total: Number(totalRow.n) };
}

export interface UpdateSourceAfterRunInput {
  source_id: string;
  last_update: string;
  checksum: string;
}

export function updateSourceAfterRun(db: Db, input: UpdateSourceAfterRunInput): void {
  db.prepare(
    `UPDATE sources SET last_update = ?, checksum = ?, updated_at = ? WHERE source_id = ?`
  ).run(input.last_update, input.checksum, input.last_update, input.source_id);
}

export interface RunRecord {
  run_id: string;
  source_id: string;
  connector: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  attempts: number;
  stats_json: string | null;
  detail: string | null;
}

export function createRun(
  db: Db,
  input: { source_id: string; connector: string; mode: string; started_at: string }
): string {
  const run_id = newId('run');
  db.prepare(
    `INSERT INTO ingestion_runs (run_id, source_id, connector, mode, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`
  ).run(run_id, input.source_id, input.connector, input.mode, input.started_at);
  return run_id;
}

export function finishRun(
  db: Db,
  run_id: string,
  input: { status: string; finished_at: string; attempts: number; stats?: unknown; detail?: string }
): void {
  db.prepare(
    `UPDATE ingestion_runs SET status = ?, finished_at = ?, attempts = ?, stats_json = ?, detail = ?
     WHERE run_id = ?`
  ).run(
    input.status,
    input.finished_at,
    input.attempts,
    input.stats ? JSON.stringify(input.stats) : null,
    input.detail ?? null,
    run_id
  );
}

export function logEvent(
  db: Db,
  run_id: string,
  stage: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
): void {
  db.prepare(
    `INSERT INTO ingestion_events (run_id, at, stage, level, message) VALUES (?, ?, ?, ?, ?)`
  ).run(run_id, new Date().toISOString(), stage, level, message);
}

export interface LastRunInfo {
  status: string;
  started_at: string;
  finished_at: string | null;
  mode: string;
  detail: string | null;
}

export function lastRunFor(db: Db, sourceId: string): LastRunInfo | null {
  const r = db
    .prepare(
      `SELECT status, started_at, finished_at, mode, detail FROM ingestion_runs
       WHERE source_id = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(sourceId) as Record<string, unknown> | undefined;
  if (!r) return null;
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    status: str(r.status) ?? 'unknown',
    started_at: str(r.started_at) ?? '',
    finished_at: str(r.finished_at),
    mode: str(r.mode) ?? 'live',
    detail: str(r.detail)
  };
}

export interface SourceCounters {
  documents: number;
  snapshots: number;
}

export function sourceCounters(db: Db, sourceId: string): SourceCounters {
  const d = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE source_id = ?`).get(sourceId) as {
    n: number;
  };
  const s = db
    .prepare(`SELECT COUNT(*) AS n FROM source_snapshots WHERE source_id = ?`)
    .get(sourceId) as { n: number };
  return { documents: Number(d.n), snapshots: Number(s.n) };
}

/** Обновить статус источника (active/failed и т.п.). */
export function setSourceStatus(db: Db, sourceId: string, status: string): void {
  db.prepare(`UPDATE sources SET status = ?, updated_at = ? WHERE source_id = ?`).run(
    status,
    new Date().toISOString(),
    sourceId
  );
}

