import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  seedGeography,
  loadRfGeoFile,
  loadMetricCatalog,
  seedMetricCatalog,
  seedMetricsDomains,
  generateSyntheticMetrics,
  storeMetrics,
  syntheticMetricsPresent,
  getTerritoryMetrics,
  getMetricValues,
  compareSubjects,
  getTrustChain
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const catalogPath = resolve(process.cwd(), 'datasets/metrics/catalog.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(resolve(process.cwd(), 'datasets/party')));
  seedGeography(db, loadRfGeoFile(rfPath));
  const catalog = loadMetricCatalog(catalogPath);
  seedMetricCatalog(db, catalog);
  seedMetricsDomains(db, catalog);
  return { db, catalog };
}

function seedMetrics(db: Db2, catalog: ReturnType<typeof loadMetricCatalog>) {
  const rf = loadRfGeoFile(rfPath);
  const subjects = rf.subjects.map((s) => ({ geo_id: s.geo_id, parent_id: `ru:fd:${s.fd}` }));
  const districts = rf.federal_districts.map((d) => ({ geo_id: d.geo_id }));
  const rows = generateSyntheticMetrics(catalog, subjects, districts, rf.country.geo_id);
  storeMetrics(db, { rows, sourceId: 'synthetic-demo', dataMode: 'SYNTHETIC' });
  return rows;
}
type Db2 = ReturnType<typeof openDb>;

describe('metrics catalog + synthetic generator', () => {
  it('каталог: 11 доменов, 28 метрик', () => {
    const { db, catalog } = fullDb();
    const n = db.prepare('SELECT COUNT(*) AS n FROM metrics_catalog').get() as { n: number };
    expect(Number(n.n)).toBe(28);
    expect(catalog.domains.length).toBe(11);
  });

  it('генератор детерминирован: одинаковые входы → одинаковые значения', () => {
    const { catalog } = fullDb();
    const rf = loadRfGeoFile(rfPath);
    const subjects = rf.subjects.map((s) => ({ geo_id: s.geo_id, parent_id: `ru:fd:${s.fd}` }));
    const districts = rf.federal_districts.map((d) => ({ geo_id: d.geo_id }));
    const a = generateSyntheticMetrics(catalog, subjects, districts, rf.country.geo_id);
    const b = generateSyntheticMetrics(catalog, subjects, districts, rf.country.geo_id);
    expect(a).toEqual(b);
    // объём: 28 метрик × (89 субъектов + 8 ФО + 1 страна) × 7 лет
    expect(a.length).toBe(28 * 98 * 7);
  });

  it('агрегаты согласованы: страна = сумма субъектов по pop_total', () => {
    const { db, catalog } = fullDb();
    const rows = seedMetrics(db, catalog);
    const year = '2025';
    const sumSubjects = rows
      .filter((r) => r.metric_code === 'pop_total' && r.period === year && r.geo_id.startsWith('ru:subject:'))
      .reduce((acc, r) => acc + r.value, 0);
    const country = rows.find(
      (r) => r.metric_code === 'pop_total' && r.period === year && r.geo_id === 'ru:country:ru'
    );
    expect(country).toBeDefined();
    expect(Math.abs((country?.value ?? 0) - sumSubjects)).toBeLessThan(1);
  });

  it('storeMetrics идемпотентен', () => {
    const { db, catalog } = fullDb();
    const rows = seedMetrics(db, catalog);
    const count1 = db.prepare('SELECT COUNT(*) AS n FROM regional_metrics').get() as { n: number };
    storeMetrics(db, { rows, sourceId: 'synthetic-demo', dataMode: 'SYNTHETIC' });
    const count2 = db.prepare('SELECT COUNT(*) AS n FROM regional_metrics').get() as { n: number };
    expect(Number(count2.n)).toBe(Number(count1.n));
    expect(syntheticMetricsPresent(db)).toBe(true);
  });
});

describe('territory metrics + provenance', () => {
  it('СПб: домены DEMOGRAPHICS…HEALTHCARE заполнены, каждый с provenance', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    const domains = getTerritoryMetrics(db, 'ru:subject:spe');
    const sections = new Set(domains.map((d) => d.section));
    for (const sec of ['DEMOGRAPHICS', 'ECONOMY', 'EMPLOYMENT', 'INCOME', 'HOUSING', 'HEALTHCARE', 'EDUCATION', 'MIGRATION']) {
      expect(sections.has(sec)).toBe(true);
    }
    const pop = domains.flatMap((d) => d.metrics).find((m) => m.code === 'pop_total');
    expect(pop).toBeDefined();
    expect(pop?.series.length).toBe(7);
    expect(pop?.provenance.source_id).toBe('synthetic-demo');
    expect(pop?.provenance.data_mode).toBe('SYNTHETIC');
    expect(pop?.provenance.methodology).toContain('Росстат');
    expect(pop?.provenance.coverage_periods).toBe(7);
    expect(pop?.trend_pct).not.toBeNull();
  });

  it('муниципалитет без метрик → пусто (INSUFFICIENT DATA в UI)', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    expect(getTerritoryMetrics(db, 'ru:municipality:psk-city')).toHaveLength(0);
  });

  it('map values: 89 субъектов по pop_total', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    const mv = getMetricValues(db, 'pop_total');
    expect(mv.values.length).toBe(89);
    expect(mv.unit).toBe('чел');
    expect(mv.data_mode).toBe('SYNTHETIC');
    const fd = getMetricValues(db, 'pop_total', { fd: 'ru:fd:szfo' });
    expect(fd.values.length).toBe(11);
  });

  it('compare: строки субъектов со значениями и ФО', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    const cmp = compareSubjects(db, ['pop_total', 'inc_avg_wage_month']);
    expect(cmp.rows.length).toBe(89);
    const spb = cmp.rows.find((r) => r.geo_id === 'ru:subject:spe');
    expect(spb?.values['pop_total']).toBeGreaterThan(0);
    expect(spb?.fd_name).toContain('Северо-Запад');
  });

  it('trust chain: VALUE → DATASET → SOURCE → METHODOLOGY + caveats', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    const chain = getTrustChain(db, 'ru:subject:spe', 'pop_total');
    expect(chain).not.toBeNull();
    expect(chain?.value).toBeGreaterThan(0);
    expect(chain?.dataset.table).toBe('regional_metrics');
    expect(chain?.dataset.row_key).toContain('ru:subject:spe|pop_total');
    expect(chain?.source.source_id).toBe('synthetic-demo');
    expect(chain?.source.grade).toBe('D');
    expect(chain?.methodology).toContain('населени');
    expect(chain?.coverage.periods).toBe(7);
    expect(chain?.caveats.some((c) => c.includes('СИНТЕТИЧЕСК'))).toBe(true);
  });

  it('trust chain: несуществующая метрика/территория → null', () => {
    const { db, catalog } = fullDb();
    seedMetrics(db, catalog);
    expect(getTrustChain(db, 'ru:subject:spe', 'nope')).toBeNull();
    expect(getTrustChain(db, 'ru:nope:nope', 'pop_total')).toBeNull();
  });
});
