import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  seedGeography,
  loadRfGeoFile,
  loadCivicTopics,
  seedCivicTopics,
  generateSyntheticCivic,
  aggregateCivicUp,
  storeCivicAggregates,
  loadMetricCatalog,
  seedMetricCatalog,
  seedMetricsDomains,
  generateSyntheticMetrics,
  storeMetrics,
  loadTopicLinks,
  computePositionMatrix,
  MATRIX_CATEGORY_RULES
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const topicsPath = resolve(process.cwd(), 'datasets/civic/topics.json');
const linksPath = resolve(process.cwd(), 'datasets/civic/topic_links.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  const file = loadCivicTopics(topicsPath);
  seedCivicTopics(db, file);
  // метрики (Regional Data): каталог + SYNTHETIC-ряды
  const catalog = loadMetricCatalog(resolve(process.cwd(), 'datasets/metrics/catalog.json'));
  seedMetricCatalog(db, catalog);
  seedMetricsDomains(db, catalog);
  const rf = loadRfGeoFile(rfPath);
  storeMetrics(db, {
    rows: generateSyntheticMetrics(
      catalog,
      rf.subjects.map((s) => ({ geo_id: s.geo_id, parent_id: `ru:fd:${s.fd}` })),
      rf.federal_districts.map((d) => ({ geo_id: d.geo_id })),
      rf.country.geo_id
    ),
    sourceId: 'synthetic-demo',
    dataMode: 'SYNTHETIC'
  });
  return { db, file };
}

/** Полный SYNTHETIC-сид настроений (субъекты + ФО + страна). */
function seedCivic(db: Db_, file: ReturnType<typeof loadCivicTopics>) {
  const rf = loadRfGeoFile(rfPath);
  const subjects = rf.subjects.map((s) => ({ geo_id: s.geo_id }));
  const months: string[] = [];
  for (let y = 2024; y <= 2026; y++)
    for (let m = 1; m <= 12; m++) {
      const p = `${y}-${String(m).padStart(2, '0')}`;
      if (p >= '2024-01' && p <= '2026-09') months.push(p);
    }
  const subjRows = generateSyntheticCivic(file, subjects, months);
  const fdMembers = new Map<string, string[]>();
  for (const s of rf.subjects) {
    const fd = `ru:fd:${s.fd}`;
    fdMembers.set(fd, [...(fdMembers.get(fd) ?? []), s.geo_id]);
  }
  const groups = [...fdMembers.entries()].map(([geo_id, members]) => ({ geo_id, members }));
  groups.push({ geo_id: rf.country.geo_id, members: rf.subjects.map((s) => s.geo_id) });
  storeCivicAggregates(db, subjRows, { sourceId: 'synthetic-civic', methodRef: 'test' });
  storeCivicAggregates(db, aggregateCivicUp(subjRows, groups), { sourceId: 'synthetic-civic', methodRef: 'test' });
}
type Db_ = ReturnType<typeof openDb>;

describe('topic_links.json', () => {
  it('валиден: 14 связей, правила сопоставления зафиксированы', () => {
    const links = loadTopicLinks(linksPath);
    expect(links.links).toHaveLength(14);
    expect(links.meta.comparison_rules).toContain('agenda_overlap');
    expect(links.meta.comparison_rules).toContain('k_min');
    expect(links.meta.methodology).toContain('не вычисляется');
    const ids = links.links.map((l) => l.link_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of links.links) {
      if (l.position_topic !== null) expect(l.position_topic.length).toBeGreaterThan(3);
    }
  });
});

describe('computePositionMatrix', () => {
  it('все 14 тем; peace/human_rights → agenda_overlap с точной формулировкой', () => {
    const { db, file } = fullDb();
    seedCivic(db, file);
    const links = loadTopicLinks(linksPath);
    const m = computePositionMatrix(db, { links, geoId: 'ru:country:ru' });
    expect(m.rows).toHaveLength(14);
    expect(m.k_min).toBe(30);

    const peace = m.rows.find((r) => r.civic_topic_id === 'peace');
    expect(peace?.comparison.status).toBe('agenda_overlap');
    expect(peace?.position).not.toBeNull();
    expect(peace?.position?.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
    expect(peace?.position?.position_id).toBe('pos-2026-mir');
    expect(peace?.comparison.wording).toContain('Наблюдается совпадение повестки');
    expect(peace?.comparison.wording).toContain('не оценивается');

    const hr = m.rows.find((r) => r.civic_topic_id === 'human_rights');
    expect(hr?.comparison.status).toBe('agenda_overlap');
    expect(hr?.position?.position_id).toBe('pos-2026-prava-cheloveka');
  });

  it('цены/ЖКХ (позиции нет) → agenda_divergence: «Не наблюдается документированной позиции»', () => {
    const { db, file } = fullDb();
    seedCivic(db, file);
    const m = computePositionMatrix(db, { links: loadTopicLinks(linksPath), geoId: 'ru:country:ru' });
    const prices = m.rows.find((r) => r.civic_topic_id === 'prices');
    expect(prices?.position).toBeNull();
    expect(prices?.comparison.status).toBe('agenda_divergence');
    expect(prices?.comparison.wording).toContain('Не наблюдается документированной позиции');
    expect(prices?.comparison.wording).toContain('не рекомендация');
    // regional-блок из каталога Этапа 5
    expect(prices?.regional.map((r) => r.metric_code)).toContain('inc_per_capita_month');
    const reg = prices?.regional.find((r) => r.metric_code === 'inc_per_capita_month');
    expect(reg?.latest_value).not.toBeNull();
    expect(reg?.data_mode).toBe('SYNTHETIC');
    // транспорт: показатель в каталоге отсутствует — честно пусто
    const transport = m.rows.find((r) => r.civic_topic_id === 'transport');
    expect(transport?.regional).toHaveLength(0);
  });

  it('СТРАЖ смешения категорий: opinion-блок не содержит текстов позиций, position-блок — полей мнения', () => {
    const { db, file } = fullDb();
    seedCivic(db, file);
    const m = computePositionMatrix(db, { links: loadTopicLinks(linksPath), geoId: 'ru:country:ru' });
    const positionsTexts = m.rows.map((r) => r.position?.exact_position ?? '').filter(Boolean);
    expect(positionsTexts.length).toBeGreaterThanOrEqual(3);
    for (const r of m.rows) {
      const opinionJson = JSON.stringify(r.opinion);
      for (const txt of positionsTexts) {
        expect(opinionJson.includes(txt.slice(0, 25))).toBe(false);
      }
      expect(opinionJson).not.toContain('exact_position');
      expect(opinionJson).not.toContain('position_id');
      const positionJson = JSON.stringify(r.position);
      expect(positionJson).not.toContain('last3_n');
      expect(positionJson).not.toContain('"mix"');
      expect(positionJson === null ? '' : positionJson).not.toContain('neg_share');
      // категория позиции — всегда и только OFFICIAL_PARTY_STATEMENT
      if (r.position) expect(r.position.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
    }
  });

  it('малая выборка → uncertainty; все строки несут caveats, глобальные category_rules на месте', () => {
    const { db } = fullDb();
    // вместо полного сида — только маленькие ручные данные
    storeCivicAggregates(
      db,
      [
        {
          geo_id: 'ru:subject:sak',
          topic_id: 'peace',
          period: '2026-08',
          n_messages: 5,
          n_positive: 1,
          n_neutral: 2,
          n_negative: 2,
          n_mixed: 0,
          n_unclear: 0,
          n_questions: 0
        }
      ],
      { sourceId: 'synthetic-civic', methodRef: 'test' }
    );
    const m = computePositionMatrix(db, { links: loadTopicLinks(linksPath), geoId: 'ru:subject:sak' });
    expect(m.rows).toHaveLength(14);
    const peace = m.rows.find((r) => r.civic_topic_id === 'peace');
    expect(peace?.comparison.status).toBe('uncertainty');
    expect(peace?.comparison.wording).toContain('k_min=30');
    for (const r of m.rows) {
      expect(r.caveats.length).toBeGreaterThanOrEqual(3);
      expect(['agenda_overlap', 'agenda_divergence', 'uncertainty']).toContain(r.comparison.status);
    }
    expect(m.category_rules).toEqual(MATRIX_CATEGORY_RULES);
    expect(m.methodology.length).toBeGreaterThan(50);
  });

  it('позиции без связи с темами не теряются (unlinked_positions), нет тем вне справочника', () => {
    const { db, file } = fullDb();
    seedCivic(db, file);
    const m = computePositionMatrix(db, { links: loadTopicLinks(linksPath), geoId: 'ru:country:ru' });
    const unlinkedTopics = m.unlinked_positions.map((p) => p.topic);
    expect(unlinkedTopics).toContain('Свободы');
    expect(m.rows.every((r) => r.civic_topic_name.length > 0)).toBe(true);
  });

  it('детерминизм: два вызова идентичны', () => {
    const { db, file } = fullDb();
    seedCivic(db, file);
    const links = loadTopicLinks(linksPath);
    const a = computePositionMatrix(db, { links, geoId: 'ru:country:ru', asOf: '2026-09-24' });
    const b = computePositionMatrix(db, { links, geoId: 'ru:country:ru', asOf: '2026-09-24' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
