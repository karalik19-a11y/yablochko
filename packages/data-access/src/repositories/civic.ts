import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * Civic Intelligence: хранилище АГРЕГАТОВ (персональные записи в схеме
 * отсутствуют), справочник тем, SYNTHETIC-генератор и derivations
 * (Issue Tracker, временные ряды темы).
 */

export const K_MIN_MESSAGES = 30;

// ---------- Каталог тем ----------

const SharesCfg = z.object({
  pos: z.number(),
  neu: z.number(),
  neg: z.number(),
  mixed: z.number(),
  unclear: z.number()
});

export const CivicTopicsFile = z.object({
  meta: z
    .object({
      note: z.string(),
      methodology: z.string(),
      k_min: z.number().default(K_MIN_MESSAGES),
      sentiment_lexicon_note: z.string().optional()
    })
    .passthrough(),
  topics: z.array(
    z.object({
      topic_id: z.string(),
      name: z.string(),
      category: z.string(),
      keywords: z.array(z.string()),
      synthetic: z
        .object({
          volume_country_month: z.number(),
          ramp: z.object({ from: z.number(), to: z.number() }).default({ from: 1, to: 1 }),
          shares: SharesCfg,
          waves: z
            .array(z.object({ months: z.array(z.number()), factor: z.number() }))
            .default([])
        })
        .optional()
    })
  )
});
export type CivicTopicsFile = z.infer<typeof CivicTopicsFile>;

export function loadCivicTopics(path: string): CivicTopicsFile {
  return CivicTopicsFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export function seedCivicTopics(db: Db, file: CivicTopicsFile): { upserted: number } {
  const ts = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO topics (topic_id, name, category, keywords_json, sort_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(topic_id) DO UPDATE SET name=excluded.name, category=excluded.category,
      keywords_json=excluded.keywords_json, sort_order=excluded.sort_order
  `);
  db.exec('BEGIN');
  try {
    file.topics.forEach((t, i) =>
      up.run(t.topic_id, t.name, t.category, JSON.stringify(t.keywords), i)
    );
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'civic_topics_seed', 'topics', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ topics: file.topics.length }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { upserted: file.topics.length };
}

export function loadTopicsFromDb(db: Db): Array<{ topic_id: string; name: string; category: string | null; keywords: string[] }> {
  const rows = db
    .prepare(`SELECT topic_id, name, category, keywords_json FROM topics ORDER BY sort_order`)
    .all() as Array<{ topic_id: string; name: string; category: string | null; keywords_json: string }>;
  return rows.map((r) => ({
    topic_id: r.topic_id,
    name: r.name,
    category: r.category,
    keywords: JSON.parse(r.keywords_json) as string[]
  }));
}

// ---------- SYNTHETIC-генератор агрегатов ----------

function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export interface SyntheticCivicRow {
  geo_id: string;
  topic_id: string;
  period: string;
  n_messages: number;
  n_positive: number;
  n_neutral: number;
  n_negative: number;
  n_mixed: number;
  n_unclear: number;
  n_questions: number;
}

/** Наибольшие остатки: суммы ровно n, доли соблюдаются. */
function allocate(n: number, shares: number[]): number[] {
  const floors = shares.map((s) => Math.floor(n * s));
  let rest = n - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, frac: n * s - (floors[i] ?? 0) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const o of order) {
    if (rest <= 0) break;
    out[o.i] = (out[o.i] ?? 0) + 1;
    rest -= 1;
  }
  return out;
}

/**
 * Детерминированные SYNTHETIC-агрегаты по субъектам; ФО и страна — суммы
 * (согласованность покрыта тестом). Демонстрирует: сезонность, тренды
 * объёма (ramp), региональные различия, малые выборки (INSUFFICIENT DATA).
 */
export function generateSyntheticCivic(
  file: CivicTopicsFile,
  subjects: Array<{ geo_id: string }>,
  months: string[]
): SyntheticCivicRow[] {
  const rows: SyntheticCivicRow[] = [];
  const monthsCount = months.length;
  // регион-фактор объёма: 0.25..2.2 (детерминирован geo_id)
  const factor = (geoId: string) => 0.25 + (hash32(geoId) % 1000) / 1000 * 1.95;
  const FACTOR_SUM = subjects.reduce((a, s) => a + factor(s.geo_id), 0) || 1;

  const subjectRows = new Map<string, SyntheticCivicRow>();
  for (const t of file.topics) {
    if (!t.synthetic) continue;
    const cfg = t.synthetic;
    for (let mi = 0; mi < monthsCount; mi++) {
      const period = months[mi] as string;
      const monthNum = Number(period.slice(5, 7));
      const ramp = cfg.ramp.from + (cfg.ramp.to - cfg.ramp.from) * (monthsCount > 1 ? mi / (monthsCount - 1) : 0);
      const wave = cfg.waves.some((w) => w.months.includes(monthNum)) ? Math.max(...cfg.waves.filter((w) => w.months.includes(monthNum)).map((w) => w.factor)) : 1;
      const V = cfg.volume_country_month * ramp * wave;

      for (const subj of subjects) {
        const f = factor(subj.geo_id) / FACTOR_SUM;
        const noise = 0.7 + (hash32(`${subj.geo_id}|${t.topic_id}|${period}`) % 100) / 100 * 0.6;
        const n = Math.max(0, Math.round(V * f * noise));
        if (n === 0) continue;
        // Доли sentiment с региональным джиттером ±3% и нормализацией.
        const jit = (k: string) => ((hash32(`${subj.geo_id}|${t.topic_id}|${k}`) % 7) - 3) / 100;
        const raw = [
          Math.max(0.01, cfg.shares.pos + jit('p')),
          Math.max(0.02, cfg.shares.neu + jit('n')),
          Math.max(0.02, cfg.shares.neg + jit('g')),
          Math.max(0.01, cfg.shares.mixed + jit('m')),
          Math.max(0.01, cfg.shares.unclear + jit('u'))
        ];
        const sum = raw.reduce((a, b) => a + b, 0);
        const shares = raw.map((r) => r / sum);
        const counts = allocate(n, shares);
        const nQuestions = Math.round(n * (0.08 + (hash32(`${subj.geo_id}|${t.topic_id}|${period}|q`) % 12) / 100));
        const row: SyntheticCivicRow = {
          geo_id: subj.geo_id,
          topic_id: t.topic_id,
          period,
          n_messages: n,
          n_positive: counts[0] ?? 0,
          n_neutral: counts[1] ?? 0,
          n_negative: counts[2] ?? 0,
          n_mixed: counts[3] ?? 0,
          n_unclear: counts[4] ?? 0,
          n_questions: nQuestions
        };
        subjectRows.set(`${subj.geo_id}|${t.topic_id}|${period}`, row);
        rows.push(row);
      }
    }
  }

  return rows;
}

/**
 * Агрегация сгенерированных строк субъекта → ФО и страна.
 * Вынесено отдельно, чтобы вызывающий код явно передал структуру иерархии.
 */
export function aggregateCivicUp(
  subjectRows: SyntheticCivicRow[],
  groups: Array<{ geo_id: string; members: string[] }>
): SyntheticCivicRow[] {
  const out: SyntheticCivicRow[] = [];
  for (const g of groups) {
    const byKey = new Map<string, SyntheticCivicRow>();
    for (const r of subjectRows) {
      if (!g.members.includes(r.geo_id)) continue;
      const k = `${r.topic_id}|${r.period}`;
      let row = byKey.get(k);
      if (!row) {
        row = {
          geo_id: g.geo_id,
          topic_id: r.topic_id,
          period: r.period,
          n_messages: 0,
          n_positive: 0,
          n_neutral: 0,
          n_negative: 0,
          n_mixed: 0,
          n_unclear: 0,
          n_questions: 0
        };
        byKey.set(k, row);
        out.push(row);
      }
      row.n_messages += r.n_messages;
      row.n_positive += r.n_positive;
      row.n_neutral += r.n_neutral;
      row.n_negative += r.n_negative;
      row.n_mixed += r.n_mixed;
      row.n_unclear += r.n_unclear;
      row.n_questions += r.n_questions;
    }
  }
  return out;
}

export function storeCivicAggregates(
  db: Db,
  rows: SyntheticCivicRow[],
  opts: { sourceId: string; methodRef: string; dataMode?: 'SYNTHETIC' | 'LIVE' }
): { stored: number } {
  const ts = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO civic_aggregates (aggregate_id, geo_id, topic_id, period, n_messages,
      n_positive, n_neutral, n_negative, n_mixed, n_unclear, n_questions,
      source_id, method_ref, data_mode, created_at, updated_at)
    VALUES ('civ-' || ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(geo_id, topic_id, period, source_id) DO UPDATE SET
      n_messages=excluded.n_messages, n_positive=excluded.n_positive,
      n_neutral=excluded.n_neutral, n_negative=excluded.n_negative,
      n_mixed=excluded.n_mixed, n_unclear=excluded.n_unclear,
      n_questions=excluded.n_questions, method_ref=excluded.method_ref,
      data_mode=excluded.data_mode, updated_at=excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const key = `${r.geo_id}_${r.topic_id}_${r.period}`;
      up.run(
        key, r.geo_id, r.topic_id, r.period, r.n_messages, r.n_positive,
        r.n_neutral, r.n_negative, r.n_mixed, r.n_unclear, r.n_questions,
        opts.sourceId, opts.methodRef, opts.dataMode ?? 'SYNTHETIC', ts, ts
      );
    }
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'civic_aggregates_seed', 'civic_aggregates', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ rows: rows.length, source: opts.sourceId }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { stored: rows.length };
}

export function syntheticCivicPresent(db: Db): boolean {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM civic_aggregates WHERE source_id = 'synthetic-civic'`)
    .get() as { n: number };
  return Number(r.n) > 0;
}

// ---------- Чтение: временные ряды и Issue Tracker ----------

function currentCivicSource(db: Db): string {
  const live = db
    .prepare(`SELECT DISTINCT source_id FROM civic_aggregates WHERE data_mode = 'LIVE' LIMIT 1`)
    .get() as { source_id: string } | undefined;
  if (live) return live.source_id;
  const any = db
    .prepare(`SELECT DISTINCT source_id FROM civic_aggregates LIMIT 1`)
    .get() as { source_id: string } | undefined;
  return any?.source_id ?? 'synthetic-civic';
}

export interface CivicMix {
  pos: number;
  neu: number;
  neg: number;
  mixed: number;
  unclear: number;
}

export interface CivicMonthRow {
  period: string;
  n: number;
  pos: number;
  neu: number;
  neg: number;
  mixed: number;
  unclear: number;
  questions: number;
  insufficient: boolean;
}

export interface CivicTopicSeries {
  topic_id: string;
  topic_name: string;
  months: CivicMonthRow[];
  totals: { n: number; questions: number; mix: CivicMix };
  last3_n: number;
  prev3_n: number;
  growth_pct: number | null;
  classification: 'rising' | 'declining' | 'new' | 'stable';
  insufficient: boolean;
}

export interface CivicOverview {
  geo_id: string;
  window_months: number;
  k_min: number;
  data_mode: string;
  methodology: string;
  topics: CivicTopicSeries[];
  total_last3: number;
}

function lastMonths(endPeriod: string, count: number): string[] {
  const parts = endPeriod.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const out: string[] = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i++) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out.reverse();
}

export function getCivicOverview(
  db: Db,
  geoId: string,
  opts: { months?: number; endPeriod?: string; methodology?: string } = {}
): CivicOverview | null {
  const months = Math.min(Math.max(opts.months ?? 12, 3), 36);
  const end =
    opts.endPeriod ??
    (db.prepare(`SELECT MAX(period) AS p FROM civic_aggregates WHERE geo_id = ?`).get(geoId) as
      | { p: string | null }
      | undefined)?.p ??
    null;
  if (!end) return null;
  const periods = lastMonths(end, months);
  const srcId = currentCivicSource(db);

  const topics = loadTopicsFromDb(db);
  const rows = db
    .prepare(
      `SELECT topic_id, period, n_messages, n_positive, n_neutral, n_negative, n_mixed, n_unclear, n_questions, data_mode
       FROM civic_aggregates
       WHERE geo_id = ? AND source_id = ? AND period >= ? AND period <= ?`
    )
    .all(geoId, srcId, periods[0] ?? '', periods[periods.length - 1] ?? '') as Array<{
    topic_id: string;
    period: string;
    n_messages: number;
    n_positive: number;
    n_neutral: number;
    n_negative: number;
    n_mixed: number;
    n_unclear: number;
    n_questions: number;
    data_mode: string;
  }>;

  type AggRow = (typeof rows)[number];
  const byTopic = new Map<string, Map<string, AggRow>>();
  let dataMode = 'SYNTHETIC';
  for (const r of rows) {
    dataMode = r.data_mode;
    let tm = byTopic.get(r.topic_id);
    if (!tm) {
      tm = new Map<string, AggRow>();
      byTopic.set(r.topic_id, tm);
    }
    tm.set(r.period, r);
  }

  const last3 = periods.slice(-3);
  const prev3 = periods.slice(-6, -3);

  const series: CivicTopicSeries[] = [];
  let totalLast3 = 0;

  for (const t of topics) {
    const tm = byTopic.get(t.topic_id);
    if (!tm || tm.size === 0) continue;

    const monthRows: CivicMonthRow[] = periods.map((p) => {
      const r = tm.get(p);
      const n = r ? r.n_messages : 0;
      return {
        period: p,
        n,
        pos: r?.n_positive ?? 0,
        neu: r?.n_neutral ?? 0,
        neg: r?.n_negative ?? 0,
        mixed: r?.n_mixed ?? 0,
        unclear: r?.n_unclear ?? 0,
        questions: r?.n_questions ?? 0,
        insufficient: n < K_MIN_MESSAGES
      };
    });

    const last3Rows = last3.map((p) => tm.get(p)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    const prev3Rows = prev3.map((p) => tm.get(p)).filter((r): r is NonNullable<typeof r> => Boolean(r));

    const last3n = last3Rows.reduce((a, r) => a + r.n_messages, 0);
    const prev3n = prev3Rows.reduce((a, r) => a + r.n_messages, 0);
    totalLast3 += last3n;

    const firstActiveIdx = monthRows.findIndex((m) => m.n > 0);
    const isNew = firstActiveIdx >= 0 && firstActiveIdx >= periods.length - 3;

    let growth: number | null = null;
    if (prev3n > 0) growth = ((last3n - prev3n) / prev3n) * 100;

    let classification: CivicTopicSeries['classification'];
    if (isNew) classification = 'new';
    else if (growth === null) classification = 'stable';
    else if (growth >= 25) classification = 'rising';
    else if (growth <= -25) classification = 'declining';
    else classification = 'stable';

    const mix: CivicMix = {
      pos: monthRows.reduce((a, m) => a + m.pos, 0),
      neu: monthRows.reduce((a, m) => a + m.neu, 0),
      neg: monthRows.reduce((a, m) => a + m.neg, 0),
      mixed: monthRows.reduce((a, m) => a + m.mixed, 0),
      unclear: monthRows.reduce((a, m) => a + m.unclear, 0)
    };

    series.push({
      topic_id: t.topic_id,
      topic_name: t.name,
      months: monthRows,
      totals: {
        n: monthRows.reduce((a, m) => a + m.n, 0),
        questions: monthRows.reduce((a, m) => a + m.questions, 0),
        mix
      },
      last3_n: last3n,
      prev3_n: prev3n,
      growth_pct: growth,
      classification,
      insufficient: last3n < K_MIN_MESSAGES
    });
  }

  series.sort((a, b) => b.last3_n - a.last3_n);

  return {
    geo_id: geoId,
    window_months: months,
    k_min: K_MIN_MESSAGES,
    data_mode: dataMode,
    methodology: opts.methodology ?? '',
    topics: series,
    total_last3: totalLast3
  };
}
