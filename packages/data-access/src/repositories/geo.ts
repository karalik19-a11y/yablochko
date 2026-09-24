import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * География РФ: иерархия 6 уровней + stable IDs (ADR-0008).
 * geo_id = ru:{level}:{код}; переименования не меняют ID (идемпотентный upsert),
 * слияния фиксируются в geo_merges.
 */

export const GEO_LEVELS = [
  'country',
  'federal_district',
  'subject',
  'municipality',
  'city',
  'district'
] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export interface GeoNodeInput {
  geo_id: string;
  level: GeoLevel;
  name: string;
  short_name?: string | null;
  parent_id?: string | null;
  official_code?: string | null;
  code_system?: string | null;
  grid_col?: number | null;
  grid_row?: number | null;
  sort_order?: number;
  meta?: Record<string, unknown>;
}

export interface GeoNode extends GeoNodeInput {
  is_active: number;
  children_count?: number;
}

const RfFile = z.object({
  meta: z.object({ note: z.string(), geo_id_scheme: z.string() }).passthrough().optional(),
  country: z.object({
    geo_id: z.string(),
    name: z.string(),
    short_name: z.string().optional(),
    level: z.literal('country')
  }),
  federal_districts: z.array(
    z.object({
      geo_id: z.string(),
      name: z.string(),
      short: z.string().optional(),
      grid: z.tuple([z.number(), z.number()])
    })
  ),
  subjects: z.array(
    z.object({
      geo_id: z.string(),
      name: z.string(),
      iso: z.string().nullable(),
      fd: z.string(),
      grid: z.tuple([z.number(), z.number()]),
      note: z.string().optional()
    })
  ),
  municipal_pilot: z
    .object({
      meta: z.object({ note: z.string(), coverage: z.string() }),
      items: z.array(
        z.object({
          geo_id: z.string(),
          name: z.string(),
          level: z.enum(['municipality', 'city', 'district']),
          parent: z.string()
        })
      )
    })
    .optional()
});
export type RfFile = z.infer<typeof RfFile>;

export function loadRfGeoFile(path: string): RfFile {
  return RfFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

/**
 * Идемпотентная загрузка справочника. geo_id — первичный ключ: повторный
 * seed обновляет поля, но не меняет ID; переименованные территории
 * сохраняют историю под тем же ID.
 */
export function seedGeography(db: Db, rf: RfFile): { upserted: number } {
  const ts = new Date().toISOString();
  let count = 0;
  const up = db.prepare(`
    INSERT INTO geography (geo_id, level, parent_id, name, short_name, official_code,
      code_system, grid_col, grid_row, meta_json, is_active, sort_order, created_at, updated_at)
    VALUES (@geo_id, @level, @parent_id, @name, @short_name, @official_code,
      @code_system, @grid_col, @grid_row, @meta_json, 1, @sort_order, @ts, @ts)
    ON CONFLICT(geo_id) DO UPDATE SET
      level=excluded.level, parent_id=excluded.parent_id, name=excluded.name,
      short_name=excluded.short_name, official_code=excluded.official_code,
      code_system=excluded.code_system, grid_col=excluded.grid_col,
      grid_row=excluded.grid_row, meta_json=excluded.meta_json,
      updated_at=excluded.updated_at
  `);

  const run = (n: GeoNodeInput) => {
    up.run({
      geo_id: n.geo_id,
      level: n.level,
      parent_id: n.parent_id ?? null,
      name: n.name,
      short_name: n.short_name ?? null,
      official_code: n.official_code ?? null,
      code_system: n.code_system ?? null,
      grid_col: n.grid_col ?? null,
      grid_row: n.grid_row ?? null,
      meta_json: n.meta ? JSON.stringify(n.meta) : null,
      sort_order: n.sort_order ?? 0,
      ts
    });
    count += 1;
  };

  db.exec('BEGIN');
  try {
    run({
      geo_id: rf.country.geo_id,
      level: 'country',
      name: rf.country.name,
      short_name: rf.country.short_name ?? rf.country.name,
      sort_order: 0
    });
    rf.federal_districts.forEach((fd, i) =>
      run({
        geo_id: fd.geo_id,
        level: 'federal_district',
        name: fd.name,
        short_name: fd.short ?? fd.name,
        parent_id: rf.country.geo_id,
        grid_col: fd.grid[0],
        grid_row: fd.grid[1],
        sort_order: i
      })
    );
    rf.subjects.forEach((s, i) =>
      run({
        geo_id: s.geo_id,
        level: 'subject',
        name: s.name,
        parent_id: `ru:fd:${s.fd}`,
        official_code: s.iso,
        code_system: s.iso ? 'ISO 3166-2:RU' : 'rf_internal',
        grid_col: s.grid[0],
        grid_row: s.grid[1],
        meta: s.note ? { note: s.note } : undefined,
        sort_order: i
      })
    );
    if (rf.municipal_pilot) {
      rf.municipal_pilot.items.forEach((m, i) =>
        run({
          geo_id: m.geo_id,
          level: m.level,
          name: m.name,
          parent_id: m.parent,
          meta: { coverage: rf.municipal_pilot?.meta.coverage ?? 'partial' },
          sort_order: i
        })
      );
    }
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'geo_seed', 'geography', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ upserted: count }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { upserted: count };
}

// ---------- Чтение ----------

function mapRow(r: Record<string, unknown>): GeoNode {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    geo_id: str(r.geo_id) ?? '',
    level: (str(r.level) ?? 'subject') as GeoLevel,
    name: str(r.name) ?? '',
    short_name: str(r.short_name),
    parent_id: str(r.parent_id),
    official_code: str(r.official_code),
    code_system: str(r.code_system),
    grid_col: n(r.grid_col),
    grid_row: n(r.grid_row),
    sort_order: Number(r.sort_order ?? 0),
    is_active: Number(r.is_active ?? 1),
    children_count: r.children_count === undefined ? undefined : Number(r.children_count)
  };
}

export function getGeoNode(db: Db, geoId: string): GeoNode | null {
  const r = db.prepare(`SELECT * FROM geography WHERE geo_id = ?`).get(geoId) as
    | Record<string, unknown>
    | undefined;
  return r ? mapRow(r) : null;
}

export function getGeoChildren(db: Db, parentId: string): GeoNode[] {
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM geography c WHERE c.parent_id = g.geo_id) AS children_count
       FROM geography g WHERE g.parent_id = ? AND g.is_active = 1
       ORDER BY g.sort_order, g.name`
    )
    .all(parentId) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export interface GeoPathNode {
  geo_id: string;
  name: string;
  level: GeoLevel;
}

/** Хлебные крошки: страна → ... → узел. */
export function getGeoPath(db: Db, geoId: string): GeoPathNode[] {
  const path: GeoPathNode[] = [];
  let current: string | null = geoId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = getGeoNode(db, current);
    if (!node) break;
    path.unshift({ geo_id: node.geo_id, name: node.name, level: node.level });
    current = node.parent_id ?? null;
  }
  return path;
}

export function searchGeo(db: Db, query: string, limit = 15): GeoNode[] {
  const q = query.trim();
  if (!q) return [];
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM geography c WHERE c.parent_id = g.geo_id) AS children_count
       FROM geography g
       WHERE g.is_active = 1 AND (g.name LIKE ? OR IFNULL(g.short_name,'') LIKE ? OR g.geo_id LIKE ?)
       ORDER BY CASE g.level
         WHEN 'country' THEN 0 WHEN 'federal_district' THEN 1 WHEN 'subject' THEN 2
         WHEN 'city' THEN 3 WHEN 'municipality' THEN 4 ELSE 5 END,
         g.name
       LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, limit) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export interface GeoTree {
  country: GeoNode | null;
  districts: Array<GeoNode & { subjects: number }>;
  totalSubjects: number;
  totalMunicipal: number;
  municipalCoverage: string;
}

export function getGeoTree(db: Db): GeoTree {
  const country = getGeoNode(db, 'ru:country:ru');
  const districtRows = db
    .prepare(
      `SELECT g.*,
         (SELECT COUNT(*) FROM geography s WHERE s.parent_id = g.geo_id AND s.level = 'subject') AS subjects
       FROM geography g WHERE g.level = 'federal_district' ORDER BY g.sort_order`
    )
    .all() as Array<Record<string, unknown>>;
  const subjectsRow = db
    .prepare(`SELECT COUNT(*) AS n FROM geography WHERE level = 'subject'`)
    .get() as { n: number };
  const munRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM geography WHERE level IN ('municipality','city','district')`
    )
    .get() as { n: number };
  return {
    country: country,
    districts: districtRows.map((r) => ({ ...mapRow(r), subjects: Number(r.subjects) })),
    totalSubjects: Number(subjectsRow.n),
    totalMunicipal: Number(munRow.n),
    municipalCoverage: 'pilot_partial'
  };
}

export interface MapFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    geo_id: string;
    name: string;
    level: GeoLevel;
    parent_id: string | null;
    parent_name: string | null;
    kind: 'cartogram' | 'boundary';
  };
}

export interface MapBundle {
  type: 'FeatureCollection';
  features: MapFeature[];
  kind: 'cartogram';
  methodology: string;
}

/** Размер ячейки картограммы (в градусах, схематично). */
export const CELL_W = 8.2;
export const CELL_H = 6.4;
export const GRID_ORIGIN_X = -60;
export const GRID_ORIGIN_Y_TOP = 76;

/**
 * FeatureCollection картограммы: ячейки субъектов в схематической сетке.
 * kind='cartogram' обязателен в methodology — это НЕ географические границы.
 */
export function buildSubjectMap(db: Db, fdFilter?: string): MapBundle {
  const rows = db
    .prepare(
      `SELECT g.*, f.name AS parent_name FROM geography g
       LEFT JOIN geography f ON f.geo_id = g.parent_id
       WHERE g.level = 'subject' AND g.is_active = 1 ${fdFilter ? 'AND g.parent_id = ?' : ''}
       ORDER BY g.name`
    )
    .all(...(fdFilter ? [fdFilter] : [])) as Array<Record<string, unknown>>;

  const features: MapFeature[] = [];
  for (const r of rows) {
    const node = mapRow(r);
    if (node.grid_col === null || node.grid_col === undefined) continue;
    if (node.grid_row === null || node.grid_row === undefined) continue;
    const x0 = GRID_ORIGIN_X + node.grid_col * CELL_W;
    const y1 = GRID_ORIGIN_Y_TOP - node.grid_row * CELL_H;
    const y0 = y1 - CELL_H;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[x0, y1], [x0 + CELL_W, y1], [x0 + CELL_W, y0], [x0, y0], [x0, y1]]]
      },
      properties: {
        geo_id: node.geo_id,
        name: node.name,
        level: 'subject',
        parent_id: node.parent_id ?? null,
        parent_name: r.parent_name ? String(r.parent_name) : null,
        kind: 'cartogram'
      }
    });
  }
  return {
    type: 'FeatureCollection',
    features,
    kind: 'cartogram',
    methodology:
      'Схематическая картограмма (tile cartogram): каждая ячейка — субъект РФ, ' +
      'позиция приблизительная, НЕ географические границы. Реальные границы подключаются ' +
      'через ingestion (см. datasets/geo/README.md).'
  };
}

/** Регистрация слияния территорий (ADR-0008). */
export function mergeGeo(
  db: Db,
  input: { from_geo_id: string; to_geo_id: string; date?: string; note?: string; source_id?: string }
): string {
  const merge_id = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO geo_merges (merge_id, from_geo_id, to_geo_id, date, note, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    merge_id,
    input.from_geo_id,
    input.to_geo_id,
    input.date ?? null,
    input.note ?? null,
    input.source_id ?? null,
    new Date().toISOString()
  );
  db.prepare(`UPDATE geography SET is_active = 0 WHERE geo_id = ?`).run(input.from_geo_id);
  return merge_id;
}

export function geoCountsByLevel(db: Db): Record<string, number> {
  const rows = db
    .prepare(`SELECT level, COUNT(*) AS n FROM geography WHERE is_active = 1 GROUP BY level`)
    .all() as Array<{ level: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.level] = Number(r.n);
  return out;
}
