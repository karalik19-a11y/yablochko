import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * Media Intelligence (Этап 11): модель публикации (издание, дата, автор,
 * тема, упоминание «ЯБЛОКО», sentiment С ОБЯЗАТЕЛЬНОЙ методологией, claims).
 * ЗАПРЕТ ЯРЛЫКОВ БЕЗ МЕТОДОЛОГИИ закреплён схемой (CHECK) и тестами.
 * До реального импорта — SYNTHETIC-корпус с фиктивными изданиями (grade D).
 */

export const MediaFile = z.object({
  meta: z.object({ note: z.string(), methodology: z.string(), as_of: z.string().optional() }).passthrough(),
  outlets: z.array(
    z.object({
      outlet_id: z.string(),
      name: z.string(),
      kind: z.enum(['newspaper', 'online', 'tv', 'radio', 'aggregator'])
    })
  ),
  articles: z.array(
    z.object({
      article_id: z.string(),
      outlet_id: z.string(),
      title: z.string(),
      published_at: z.string(),
      author: z.string().nullable().default(null),
      url: z.string().nullable().default(null),
      topic_id: z.string().nullable().default(null),
      mentions_yabloko: z.number().int().default(0),
      mention_context: z.enum(['positive', 'neutral', 'negative', 'unclear']).nullable().default(null),
      sentiment_methodology: z.string().nullable().default(null),
      claim_note: z.string().nullable().default(null)
    })
  ),
  claims: z
    .array(
      z.object({
        claim_id: z.string(),
        article_id: z.string().nullable().default(null),
        claim_text: z.string(),
        claim_category: z.enum(['party_statement', 'external_claim', 'unverified_claim'])
      })
    )
    .default([])
});
export type MediaFile = z.infer<typeof MediaFile>;

export function loadMediaFile(path: string): MediaFile {
  return MediaFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export const MEDIA_SENTIMENT_METHODOLOGY_FALLBACK =
  'media-sentiment/lexicon-v1: детерминированный лексикон тональности упоминания (отрицание в окне 2 слова); ' +
  'классы positive/neutral/negative/unclear; ярлык без этой сноски запрещён.';

export function seedMedia(db: Db, file: MediaFile, opts: { sourceId: string; methodology?: string }): { outlets: number; articles: number; claims: number } {
  const ts = new Date().toISOString();
  const methodology = opts.methodology ?? file.meta.methodology;
  db.exec('BEGIN');
  try {
    const upOutlet = db.prepare(`
      INSERT INTO media_outlets (outlet_id, name, kind, source_id, data_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'SYNTHETIC', ?, ?)
      ON CONFLICT(outlet_id) DO UPDATE SET name=excluded.name, kind=excluded.kind,
        source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    for (const o of file.outlets) upOutlet.run(o.outlet_id, o.name, o.kind, opts.sourceId, ts, ts);

    const upArticle = db.prepare(`
      INSERT INTO media_articles (article_id, outlet_id, title, published_at, author, url, topic_id,
        mentions_yabloko, mention_context, sentiment_methodology, claim_note, source_id, data_mode,
        verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC', 'UNVERIFIED', ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET outlet_id=excluded.outlet_id, title=excluded.title,
        published_at=excluded.published_at, author=excluded.author, url=excluded.url, topic_id=excluded.topic_id,
        mentions_yabloko=excluded.mentions_yabloko, mention_context=excluded.mention_context,
        sentiment_methodology=excluded.sentiment_methodology, claim_note=excluded.claim_note,
        source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    let n = 0;
    for (const a of file.articles) {
      // До-запись методологии: ярлык без сноски не допускается и на уровне приложения.
      const context = a.mention_context;
      const method = a.sentiment_methodology ?? (context ? methodology : null);
      upArticle.run(
        a.article_id, a.outlet_id, a.title, a.published_at, a.author, a.url, a.topic_id,
        a.mentions_yabloko, context, method, a.claim_note, opts.sourceId, ts, ts
      );
      n += 1;
    }

    const upClaim = db.prepare(`
      INSERT INTO media_claims (claim_id, article_id, claim_text, claim_category, source_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(claim_id) DO UPDATE SET article_id=excluded.article_id, claim_text=excluded.claim_text,
        claim_category=excluded.claim_category, source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    for (const c of file.claims) upClaim.run(c.claim_id, c.article_id, c.claim_text, c.claim_category, opts.sourceId, ts, ts);

    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'media_seed', 'media_articles', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ outlets: file.outlets.length, articles: n, claims: file.claims.length }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { outlets: file.outlets.length, articles: file.articles.length, claims: file.claims.length };
}

// ---------- Чтение ----------

export interface MediaArticle {
  article_id: string;
  outlet_id: string;
  outlet_name: string;
  outlet_kind: string;
  title: string;
  published_at: string;
  author: string | null;
  url: string | null;
  topic_id: string | null;
  topic_name: string | null;
  mentions_yabloko: boolean;
  mention_context: string | null;
  sentiment_methodology: string | null;
  claim_note: string | null;
  source_id: string;
  data_mode: string;
  verification_status: string;
}

export interface MediaMentionsResult {
  items: MediaArticle[];
  total: number;
  mentions: number;
  context_split: { positive: number; neutral: number; negative: number; unclear: number };
  methodology: string;
}

export function getMediaMentions(
  db: Db,
  filter: { topicId?: string; outletId?: string; months?: number; endPeriod?: string; onlyMentions?: boolean; q?: string } = {},
  methodology: string
): MediaMentionsResult {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  let endPeriod = filter.endPeriod;
  if (!endPeriod) {
    const r = db.prepare(`SELECT MAX(substr(published_at,1,7)) AS p FROM media_articles`).get() as { p: string | null };
    endPeriod = r.p ?? '2026-09';
  }
  const parts = endPeriod.split('-').map(Number);
  const y0 = parts[0] ?? 2026;
  const m0 = parts[1] ?? 9;
  const monthsN = Math.min(Math.max(filter.months ?? 12, 1), 36);
  let startY = y0;
  let startM = m0 - monthsN + 1;
  while (startM <= 0) {
    startM += 12;
    startY -= 1;
  }
  const startPeriod = `${startY}-${String(startM).padStart(2, '0')}`;
  conds.push(`substr(published_at,1,7) >= ?`);
  params.push(startPeriod);
  conds.push(`substr(published_at,1,7) <= ?`);
  params.push(endPeriod);
  if (filter.topicId) {
    conds.push('a.topic_id = ?');
    params.push(filter.topicId);
  }
  if (filter.outletId) {
    conds.push('a.outlet_id = ?');
    params.push(filter.outletId);
  }
  if (filter.onlyMentions) {
    conds.push('a.mentions_yabloko = 1');
  }
  if (filter.q && filter.q.trim() !== '') {
    // Фильтр по заголовку в JS (lower() SQLite не работает с кириллицей) — после SQL-фильтров.
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT a.*, o.name AS outlet_name, o.kind AS outlet_kind, t.name AS topic_name
       FROM media_articles a
       JOIN media_outlets o ON o.outlet_id = a.outlet_id
       LEFT JOIN topics t ON t.topic_id = a.topic_id
       ${where}
       ORDER BY a.published_at DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const q = filter.q?.trim().toLowerCase() ?? '';
  const items: MediaArticle[] = [];
  const split = { positive: 0, neutral: 0, negative: 0, unclear: 0 };
  let mentions = 0;
  for (const r of rows) {
    if (q !== '' && !String(r.title).toLowerCase().includes(q)) continue;
    const ctx = (r.mention_context as string | null) ?? null;
    if (ctx === 'positive') split.positive += 1;
    else if (ctx === 'neutral') split.neutral += 1;
    else if (ctx === 'negative') split.negative += 1;
    else if (ctx === 'unclear') split.unclear += 1;
    if (Number(r.mentions_yabloko) === 1) mentions += 1;
    items.push({
      article_id: String(r.article_id),
      outlet_id: String(r.outlet_id),
      outlet_name: String(r.outlet_name),
      outlet_kind: String(r.outlet_kind),
      title: String(r.title),
      published_at: String(r.published_at),
      author: (r.author as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      topic_id: (r.topic_id as string | null) ?? null,
      topic_name: (r.topic_name as string | null) ?? null,
      mentions_yabloko: Number(r.mentions_yabloko) === 1,
      mention_context: ctx,
      sentiment_methodology: (r.sentiment_methodology as string | null) ?? null,
      claim_note: (r.claim_note as string | null) ?? null,
      source_id: String(r.source_id),
      data_mode: String(r.data_mode),
      verification_status: String(r.verification_status)
    });
  }
  return { items, total: items.length, mentions, context_split: split, methodology };
}

export interface MediaTopicRow {
  topic_id: string;
  topic_name: string;
  articles: number;
  mentions: number;
  context_split: { positive: number; neutral: number; negative: number; unclear: number };
  neg_share_pct: number | null;
}

export interface MediaTopicsSummary {
  items: MediaTopicRow[];
  methodology: string;
  total_articles: number;
  total_mentions: number;
}

export function getMediaTopics(db: Db, filter: { months?: number; endPeriod?: string } = {}, methodology: string): MediaTopicsSummary {
  const { items: all, methodology: _m } = getMediaMentions(db, { months: filter.months ?? 12, endPeriod: filter.endPeriod }, methodology);
  void _m;
  const byTopic = new Map<string, MediaTopicRow>();
  for (const a of all) {
    if (!a.topic_id) continue;
    let row = byTopic.get(a.topic_id);
    if (!row) {
      row = { topic_id: a.topic_id, topic_name: a.topic_name ?? a.topic_id, articles: 0, mentions: 0, context_split: { positive: 0, neutral: 0, negative: 0, unclear: 0 }, neg_share_pct: null };
      byTopic.set(a.topic_id, row);
    }
    row.articles += 1;
    if (a.mentions_yabloko) {
      row.mentions += 1;
      if (a.mention_context === 'positive') row.context_split.positive += 1;
      else if (a.mention_context === 'neutral') row.context_split.neutral += 1;
      else if (a.mention_context === 'negative') row.context_split.negative += 1;
      else if (a.mention_context === 'unclear') row.context_split.unclear += 1;
    }
  }
  const items = [...byTopic.values()];
  for (const r of items) {
    const withCtx = r.context_split.positive + r.context_split.neutral + r.context_split.negative + r.context_split.unclear;
    r.neg_share_pct = withCtx > 0 ? (r.context_split.negative / withCtx) * 100 : null;
  }
  items.sort((a, b) => b.articles - a.articles);
  return {
    items,
    methodology,
    total_articles: all.length,
    total_mentions: all.filter((a) => a.mentions_yabloko).length
  };
}

export interface MediaTrendPoint {
  period: string;
  articles: number;
  mentions: number;
  share_pct: number | null;
}

export interface MediaTrend {
  points: MediaTrendPoint[];
  methodology: string;
}

/** Доля публикаций с упоминанием «ЯБЛОКО» по месяцам (констатация, не оценка СМИ). */
export function getMediaTrend(db: Db, filter: { months?: number; endPeriod?: string } = {}, methodology: string): MediaTrend {
  const monthsN = Math.min(Math.max(filter.months ?? 12, 1), 36);
  let endPeriod = filter.endPeriod;
  if (!endPeriod) {
    const r = db.prepare(`SELECT MAX(substr(published_at,1,7)) AS p FROM media_articles`).get() as { p: string | null };
    endPeriod = r.p ?? '2026-09';
  }
  const rows = db
    .prepare(
      `SELECT substr(published_at,1,7) AS period, COUNT(*) AS articles,
              SUM(mentions_yabloko) AS mentions
       FROM media_articles
       WHERE substr(published_at,1,7) >= ?
       GROUP BY period ORDER BY period`
    )
    .all(startPeriodOf(endPeriod, monthsN)) as Array<{ period: string; articles: number; mentions: number | null }>;
  const points = rows.map((r) => ({
    period: r.period,
    articles: Number(r.articles),
    mentions: Number(r.mentions ?? 0),
    share_pct: Number(r.articles) > 0 ? (Number(r.mentions ?? 0) / Number(r.articles)) * 100 : null
  }));
  return { points, methodology };
}

function startPeriodOf(endPeriod: string, months: number): string {
  const parts = endPeriod.split('-').map(Number);
  let y = parts[0] ?? 2026;
  let m = (parts[1] ?? 9) - months + 1;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export interface MediaOutletRow {
  outlet_id: string;
  name: string;
  kind: string;
  articles: number;
  mentions: number;
  data_mode: string;
}

export function getMediaOutlets(db: Db): MediaOutletRow[] {
  const rows = db
    .prepare(
      `SELECT o.outlet_id, o.name, o.kind, o.data_mode,
              COUNT(a.article_id) AS articles,
              COALESCE(SUM(a.mentions_yabloko), 0) AS mentions
       FROM media_outlets o
       LEFT JOIN media_articles a ON a.outlet_id = o.outlet_id
       GROUP BY o.outlet_id ORDER BY articles DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    outlet_id: String(r.outlet_id),
    name: String(r.name),
    kind: String(r.kind),
    articles: Number(r.articles),
    mentions: Number(r.mentions),
    data_mode: String(r.data_mode)
  }));
}

export interface MediaClaimRow {
  claim_id: string;
  claim_text: string;
  claim_category: string;
  source_id: string;
}

export function getMediaClaims(db: Db): MediaClaimRow[] {
  const rows = db.prepare(`SELECT claim_id, claim_text, claim_category, source_id FROM media_claims ORDER BY claim_id`).all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    claim_id: String(r.claim_id),
    claim_text: String(r.claim_text),
    claim_category: String(r.claim_category),
    source_id: String(r.source_id)
  }));
}
