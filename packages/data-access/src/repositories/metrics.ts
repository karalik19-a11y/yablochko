import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * Population Intelligence: единый формат territorial-показателей
 * regional_metrics (value/period/source/quality/methodology) + справочник
 * метрик + детерминированный SYNTHETIC-генератор (ADR-0005).
 *
 * Каждый запрос отдаёт provenance: источник (grade/note/license/last_update/
 * checksum), методологию, покрытие периодами, data_mode.
 */

// ---------- Каталог ----------

const SyntheticCfg = z.object({
  min: z.number(),
  max: z.number(),
  trend: z.tuple([z.number(), z.number()]),
  noise: z.number()
});

export const MetricCatalogFile = z.object({
  meta: z.object({ note: z.string() }).passthrough(),
  domains: z.array(
    z.object({ domain: z.string(), title: z.string(), section: z.string() })
  ),
  metrics: z.array(
    z.object({
      code: z.string(),
      domain: z.string(),
      name: z.string(),
      unit: z.string(),
      agg: z.enum(['sum', 'weighted']).default('weighted'),
      methodology: z.string(),
      synthetic: SyntheticCfg.optional()
    })
  )
});
export type MetricCatalogFile = z.infer<typeof MetricCatalogFile>;
export type MetricDef = MetricCatalogFile['metrics'][number];

export function loadMetricCatalog(path: string): MetricCatalogFile {
  return MetricCatalogFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export function seedMetricCatalog(db: Db, catalog: MetricCatalogFile): { upserted: number } {
  const ts = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO metrics_catalog (metric_code, domain, name, unit, periodicity, agg, methodology, created_at, updated_at)
    VALUES (@code, @domain, @name, @unit, 'annual', @agg, @methodology, @ts, @ts)
    ON CONFLICT(metric_code) DO UPDATE SET
      domain=excluded.domain, name=excluded.name, unit=excluded.unit,
      agg=excluded.agg, methodology=excluded.methodology, updated_at=excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const m of catalog.metrics) {
      up.run({ code: m.code, domain: m.domain, name: m.name, unit: m.unit, agg: m.agg, methodology: m.methodology, ts });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { upserted: catalog.metrics.length };
}

// ---------- SYNTHETIC-генератор (детерминированный) ----------

function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticMetricRow {
  geo_id: string;
  metric_code: string;
  period: string;
  value: number;
}

/**
 * Генерирует SYNTHETIC-ряды 2019–2025. Детерминирован: одинаковый seed →
 * одинаковые значения (покрыто тестом). Для ФО и страны значения считаются
 * из субъектов: agg=sum → сумма; agg=weighted → средневзвешенное по pop_total.
 */
export function generateSyntheticMetrics(
  catalog: MetricCatalogFile,
  subjects: Array<{ geo_id: string; parent_id: string | null }>,
  districts: Array<{ geo_id: string }>,
  countryGeoId: string,
  years: number[] = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
): SyntheticMetricRow[] {
  const byCode = new Map(catalog.metrics.map((m) => [m.code, m]));
  const rows: SyntheticMetricRow[] = [];
  const seriesBySubject = new Map<string, number[]>();

  for (const m of catalog.metrics) {
    if (!m.synthetic) continue;
    for (const subj of subjects) {
      const rng = mulberry32(hash32(`${subj.geo_id}::${m.code}`));
      const { min, max, trend, noise } = m.synthetic;
      let base = min + (max - min) * rng();
      const annualTrend = trend[0] + (trend[1] - trend[0]) * rng();
      const vals: number[] = [];
      for (let y = 0; y < years.length; y++) {
        const drift = Math.pow(1 + annualTrend / 100, y);
        const jitter = 1 + ((rng() - 0.5) * 2 * noise) / 100;
        let v = base * drift * jitter;
        if (v < 0) v = 0;
        vals.push(Math.round(v * 1000) / 1000);
      }
      base = vals[0] ?? base;
      rows.push(...vals.map((value, i) => ({ geo_id: subj.geo_id, metric_code: m.code, period: String(years[i]), value })));
      seriesBySubject.set(`${subj.geo_id}::${m.code}`, vals);
    }
  }

  // Агрегаты для ФО и страны.
  const subjectByParent = new Map<string, string[]>();
  for (const s of subjects) {
    const key = s.parent_id ?? '';
    const arr = subjectByParent.get(key);
    if (arr) arr.push(s.geo_id);
    else subjectByParent.set(key, [s.geo_id]);
  }
  const allSubjects = subjects.map((s) => s.geo_id);
  const groups: Array<{ geo_id: string; members: string[] }> = [
    ...districts.map((d) => ({ geo_id: d.geo_id, members: subjectByParent.get(d.geo_id) ?? [] })),
    { geo_id: countryGeoId, members: allSubjects }
  ];

  for (const g of groups) {
    if (g.members.length === 0) continue;
    for (const m of catalog.metrics) {
      if (!m.synthetic) continue;
      for (let y = 0; y < years.length; y++) {
        let value: number;
        if (m.agg === 'sum' || m.code === 'pop_total') {
          value = 0;
          for (const s of g.members) {
            value += seriesBySubject.get(`${s}::${m.code}`)?.[y] ?? 0;
          }
        } else {
          // Средневзвешенное по населению.
          let wsum = 0;
          let w = 0;
          for (const s of g.members) {
            const pop = seriesBySubject.get(`${s}::pop_total`)?.[y] ?? 0;
            const v = seriesBySubject.get(`${s}::${m.code}`)?.[y] ?? 0;
            wsum += v * pop;
            w += pop;
          }
          value = w > 0 ? wsum / w : 0;
        }
        rows.push({
          geo_id: g.geo_id,
          metric_code: m.code,
          period: String(years[y]),
          value: Math.round(value * 1000) / 1000
        });
      }
    }
  }
  void byCode;
  return rows;
}

export interface StoreMetricsInput {
  rows: SyntheticMetricRow[];
  sourceId: string;
  dataMode?: 'SYNTHETIC' | 'LIVE';
}

/** Идемпотентная запись метрик (UNIQUE geo_id+code+period+source). */
export function storeMetrics(db: Db, input: StoreMetricsInput): { stored: number } {
  const ts = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO regional_metrics (geo_id, metric_code, period, value, source_id,
      quality_grade, methodology_ref, data_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'D', NULL, ?, ?, ?)
    ON CONFLICT(geo_id, metric_code, period, source_id) DO UPDATE SET
      value=excluded.value, data_mode=excluded.data_mode, updated_at=excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const r of input.rows) {
      up.run(r.geo_id, r.metric_code, r.period, r.value, input.sourceId, input.dataMode ?? 'SYNTHETIC', ts, ts);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { stored: input.rows.length };
}

export function syntheticMetricsPresent(db: Db): boolean {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM regional_metrics WHERE source_id = 'synthetic-demo'`)
    .get() as { n: number };
  return Number(r.n) > 0;
}

// ---------- Чтение с provenance ----------

export interface MetricSeriesPoint {
  period: string;
  value: number;
}

export interface MetricProvenance {
  source_id: string;
  source_name: string;
  source_grade: string;
  source_note: string;
  license: string | null;
  url: string | null;
  last_update: string | null;
  checksum: string | null;
  data_mode: string;
  methodology: string | null;
  coverage_periods: number;
  first_period: string | null;
  last_period: string | null;
}

export interface MetricView {
  code: string;
  domain: string;
  name: string;
  unit: string;
  latest: MetricSeriesPoint | null;
  previous: MetricSeriesPoint | null;
  trend_abs: number | null;
  trend_pct: number | null;
  series: MetricSeriesPoint[];
  provenance: MetricProvenance;
}

export interface DomainView {
  domain: string;
  title: string;
  section: string;
  metrics: MetricView[];
}

function provenanceFor(
  db: Db,
  m: MetricDefLike,
  periods: string[],
  dataMode: string
): MetricProvenance {
  const r = db
    .prepare(
      `SELECT s.source_id, s.name AS source_name, s.reliability_metadata, s.license,
              s.url, s.last_update, s.checksum
       FROM sources s WHERE s.source_id = ?`
    )
    .get(currentSourceId(db)) as Record<string, unknown> | undefined;
  let grade = '—';
  let note = '';
  if (r) {
    const raw = r.reliability_metadata;
    if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw) as { grade?: string; note?: string };
        grade = p.grade ?? '—';
        note = p.note ?? '';
      } catch {
        /* ignore */
      }
    }
  }
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    source_id: str(r?.source_id) ?? '—',
    source_name: str(r?.source_name) ?? '—',
    source_grade: grade,
    source_note: note,
    license: str(r?.license),
    url: str(r?.url),
    last_update: str(r?.last_update),
    checksum: str(r?.checksum),
    data_mode: dataMode,
    methodology: m.methodology ?? null,
    coverage_periods: periods.length,
    first_period: periods[0] ?? null,
    last_period: periods[periods.length - 1] ?? null
  };
}

type MetricDefLike = { methodology: string | null };

function currentSourceId(db: Db): string {
  // Приоритет: источник с наиболее свежими данными по метрике; сейчас —
  // единственный канал (synthetic-demo) или реальный импортёр, когда появится.
  const r = db
    .prepare(
      `SELECT source_id FROM regional_metrics
       WHERE data_mode = 'LIVE' LIMIT 1`
    )
    .get() as { source_id: string } | undefined;
  if (r) return r.source_id;
  const r2 = db
    .prepare(`SELECT DISTINCT source_id FROM regional_metrics LIMIT 1`)
    .get() as { source_id: string } | undefined;
  return r2?.source_id ?? 'synthetic-demo';
}

/** Все метрики территории, сгруппированные по доменам, с рядами и provenance. */
export function getTerritoryMetrics(db: Db, geoId: string): DomainView[] {
  const domains = db
    .prepare(`SELECT domain, title, section FROM metrics_domains ORDER BY sort_order`)
    .all() as Array<{ domain: string; title: string; section: string }>;
  const metrics = db
    .prepare(`SELECT * FROM metrics_catalog ORDER BY domain, metric_code`)
    .all() as Array<{
    metric_code: string;
    domain: string;
    name: string;
    unit: string;
    methodology: string | null;
  }>;
  const srcId = currentSourceId(db);

  const out: DomainView[] = [];
  for (const dom of domains) {
    const domMetrics = metrics.filter((m) => m.domain === dom.domain);
    if (domMetrics.length === 0) continue;
    const views: MetricView[] = [];
    for (const m of domMetrics) {
      const rows = db
        .prepare(
          `SELECT period, value, data_mode FROM regional_metrics
           WHERE geo_id = ? AND metric_code = ? AND source_id = ?
           ORDER BY period`
        )
        .all(geoId, m.metric_code, srcId) as Array<{
        period: string;
        value: number;
        data_mode: string;
      }>;
      if (rows.length === 0) continue;
      const series = rows.map((r) => ({ period: r.period, value: Number(r.value) }));
      const latest = series[series.length - 1] ?? null;
      const previous = series.length > 1 ? (series[series.length - 2] ?? null) : null;
      const trend_abs = latest && previous ? latest.value - previous.value : null;
      const trend_pct =
        latest && previous && previous.value !== 0
          ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
          : null;
      views.push({
        code: m.metric_code,
        domain: m.domain,
        name: m.name,
        unit: m.unit,
        latest,
        previous,
        trend_abs,
        trend_pct,
        series,
        provenance: provenanceFor(
          db,
          { methodology: m.methodology },
          series.map((s) => s.period),
          rows[0]?.data_mode ?? 'SYNTHETIC'
        )
      });
    }
    if (views.length > 0) {
      out.push({ domain: dom.domain, title: dom.title, section: dom.section, metrics: views });
    }
  }
  return out;
}


/** Значения метрики по всем субъектам (для слоя карты и таблиц сравнения). */
export interface MetricMapPoint {
  geo_id: string;
  name: string;
  parent_id: string | null;
  value: number;
  period: string;
  unit: string;
  data_mode: string;
}

export function getMetricValues(
  db: Db,
  code: string,
  opts: { fd?: string; period?: 'latest' | string } = {}
): { unit: string; name: string; data_mode: string; period: string; values: MetricMapPoint[] } {
  const srcId = currentSourceId(db);
  const period =
    opts.period && opts.period !== 'latest'
      ? opts.period
      : (db
          .prepare(`SELECT MAX(period) AS p FROM regional_metrics WHERE metric_code = ?`)
          .get(code) as { p: string | null }).p ?? '2025';
  const meta = db
    .prepare(`SELECT name, unit FROM metrics_catalog WHERE metric_code = ?`)
    .get(code) as { name: string; unit: string } | undefined;

  const rows = db
    .prepare(
      `SELECT rm.geo_id, rm.value, rm.data_mode, g.name, g.parent_id
       FROM regional_metrics rm
       JOIN geography g ON g.geo_id = rm.geo_id
       WHERE rm.metric_code = ? AND rm.period = ? AND rm.source_id = ?
         AND g.level = 'subject' ${opts.fd ? 'AND g.parent_id = ?' : ''}
       ORDER BY g.name`
    )
    .all(...(opts.fd ? [code, period, srcId, opts.fd] : [code, period, srcId])) as Array<{
    geo_id: string;
    value: number;
    data_mode: string;
    name: string;
    parent_id: string | null;
  }>;

  return {
    unit: meta?.unit ?? '',
    name: meta?.name ?? code,
    data_mode: rows[0]?.data_mode ?? 'SYNTHETIC',
    period,
    values: rows.map((r) => ({
      geo_id: r.geo_id,
      name: r.name,
      parent_id: r.parent_id,
      value: Number(r.value),
      period,
      unit: meta?.unit ?? '',
      data_mode: r.data_mode
    }))
  };
}

/** Таблица сравнения субъектов по набору метрик (latest период). */
export interface CompareRow {
  geo_id: string;
  name: string;
  parent_id: string | null;
  fd_name: string | null;
  values: Record<string, number | null>;
  units: Record<string, string>;
}

export function compareSubjects(
  db: Db,
  codes: string[],
  opts: { fd?: string } = {}
): { period: string; rows: CompareRow[] } {
  const srcId = currentSourceId(db);
  const periodRow = db
    .prepare(`SELECT MAX(period) AS p FROM regional_metrics`)
    .get() as { p: string | null };
  const period = periodRow.p ?? '2025';

  const placeholders = codes.map(() => '?').join(',');
  const sql = `
    SELECT rm.geo_id, rm.metric_code, rm.value, g.name, g.parent_id,
           (SELECT f.name FROM geography f WHERE f.geo_id = g.parent_id) AS fd_name
    FROM regional_metrics rm
    JOIN geography g ON g.geo_id = rm.geo_id
    WHERE rm.metric_code IN (${placeholders}) AND rm.period = ? AND rm.source_id = ?
      AND g.level = 'subject' ${opts.fd ? 'AND g.parent_id = ?' : ''}
    ORDER BY g.name`;
  const params: string[] = [...codes, period, srcId];
  if (opts.fd) params.push(opts.fd);
  const rows = db.prepare(sql).all(...params) as Array<{
    geo_id: string;
    metric_code: string;
    value: number;
    name: string;
    parent_id: string | null;
    fd_name: string | null;
  }>;

  const unitsRows = db
    .prepare(`SELECT metric_code, unit FROM metrics_catalog WHERE metric_code IN (${placeholders})`)
    .all(...codes) as Array<{ metric_code: string; unit: string }>;
  const unitsByCode: Record<string, string> = {};
  for (const u of unitsRows) unitsByCode[u.metric_code] = u.unit;

  const byGeo = new Map<string, CompareRow>();
  for (const r of rows) {
    let row = byGeo.get(r.geo_id);
    if (!row) {
      row = {
        geo_id: r.geo_id,
        name: r.name,
        parent_id: r.parent_id,
        fd_name: r.fd_name,
        values: {},
        units: unitsByCode
      };
      byGeo.set(r.geo_id, row);
    }
    row.values[r.metric_code] = Number(r.value);
  }
  return { period, rows: [...byGeo.values()] };
}

/**
 * Цепочка доказательств «Why should I trust this?»:
 * VALUE → DATASET (regional_metrics) → SOURCE → METHODOLOGY/DOCUMENT.
 */
export interface TrustChain {
  geo_id: string;
  geo_name: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  period: string;
  value: number;
  data_mode: string;
  dataset: {
    table: string;
    row_key: string;
    updated_at: string | null;
  };
  source: {
    source_id: string;
    name: string;
    owner: string | null;
    url: string | null;
    license: string | null;
    collection_method: string | null;
    grade: string;
    note: string;
    last_update: string | null;
    checksum: string | null;
  };
  methodology: string | null;
  coverage: { periods: number; first: string | null; last: string | null };
  caveats: string[];
}

export function getTrustChain(db: Db, geoId: string, code: string): TrustChain | null {
  const srcId = currentSourceId(db);
  const row = db
    .prepare(
      `SELECT rm.*, g.name AS geo_name, c.name AS metric_name, c.unit, c.methodology
       FROM regional_metrics rm
       JOIN geography g ON g.geo_id = rm.geo_id
       JOIN metrics_catalog c ON c.metric_code = rm.metric_code
       WHERE rm.geo_id = ? AND rm.metric_code = ? AND rm.source_id = ?
       ORDER BY rm.period DESC LIMIT 1`
    )
    .get(geoId, code, srcId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const s = db.prepare(`SELECT * FROM sources WHERE source_id = ?`).get(srcId) as
    | Record<string, unknown>
    | undefined;
  let grade = '—';
  let note = '';
  if (s?.reliability_metadata) {
    try {
      const p = JSON.parse(String(s.reliability_metadata)) as { grade?: string; note?: string };
      grade = p.grade ?? '—';
      note = p.note ?? '';
    } catch {
      /* ignore */
    }
  }
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(period) AS first, MAX(period) AS last
       FROM regional_metrics WHERE geo_id = ? AND metric_code = ? AND source_id = ?`
    )
    .get(geoId, code, srcId) as { n: number; first: string | null; last: string | null };

  const dataMode = str(row.data_mode) ?? 'SYNTHETIC';
  const caveats: string[] = [];
  if (dataMode === 'SYNTHETIC') {
    caveats.push(
      'Значение СИНТЕТИЧЕСКОЕ (генератор тест-данных): не использовать для выводов о реальности.'
    );
  }
  caveats.push('Тренд — разность соседних лет, не причинно-следственная связь.');

  return {
    geo_id: geoId,
    geo_name: str(row.geo_name) ?? '',
    metric_code: code,
    metric_name: str(row.metric_name) ?? '',
    unit: str(row.unit) ?? '',
    period: str(row.period) ?? '',
    value: Number(row.value),
    data_mode: dataMode,
    dataset: {
      table: 'regional_metrics',
      row_key: `${geoId}|${code}|${str(row.period)}|${srcId}`,
      updated_at: str(row.updated_at)
    },
    source: {
      source_id: str(s?.source_id) ?? srcId,
      name: str(s?.name) ?? '',
      owner: str(s?.owner),
      url: str(s?.url),
      license: str(s?.license),
      collection_method: str(s?.collection_method),
      grade,
      note,
      last_update: str(s?.last_update),
      checksum: str(s?.checksum)
    },
    methodology: str(row.methodology),
    coverage: {
      periods: Number(countRow.n),
      first: countRow.first ?? null,
      last: countRow.last ?? null
    },
    caveats
  };
}

/** Регистрация справочника доменов (титулы/секции из catalog.json). */
export function seedMetricsDomains(db: Db, catalog: MetricCatalogFile): void {
  const ts = new Date().toISOString();
  db.exec(`CREATE TABLE IF NOT EXISTS metrics_domains (
    domain TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  const up = db.prepare(`
    INSERT INTO metrics_domains (domain, title, section, sort_order) VALUES (?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET title=excluded.title, section=excluded.section,
      sort_order=excluded.sort_order
  `);
  db.exec('BEGIN');
  try {
    catalog.domains.forEach((d, i) => up.run(d.domain, d.title, d.section, i));
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'metrics_catalog_seed', 'metrics_catalog', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ domains: catalog.domains.length, metrics: catalog.metrics.length }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
