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
  loadTopicsFromDb,
  generateSyntheticCivic,
  aggregateCivicUp,
  storeCivicAggregates,
  syntheticCivicPresent,
  getCivicOverview,
  K_MIN_MESSAGES
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const topicsPath = resolve(process.cwd(), 'datasets/civic/topics.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  const file = loadCivicTopics(topicsPath);
  seedCivicTopics(db, file);
  return { db, file };
}

/** Ручная строка агрегата (mix суммируется в n). */
function row(
  geo: string,
  topic: string,
  period: string,
  n: number,
  mix: { pos?: number; neu?: number; neg?: number; mixed?: number; unclear?: number }
) {
  return {
    geo_id: geo,
    topic_id: topic,
    period,
    n_messages: n,
    n_positive: mix.pos ?? 0,
    n_neutral: mix.neu ?? 0,
    n_negative: mix.neg ?? 0,
    n_mixed: mix.mixed ?? 0,
    n_unclear: mix.unclear ?? 0,
    n_questions: 0
  };
}

describe('каталог тем', () => {
  it('topics.json: 14 тем, k_min=30, методология заполнена', () => {
    const file = loadCivicTopics(topicsPath);
    expect(file.topics).toHaveLength(14);
    expect(file.meta.k_min).toBe(K_MIN_MESSAGES);
    expect(file.meta.methodology.length).toBeGreaterThan(50);
    for (const t of file.topics) {
      expect(t.keywords.length).toBeGreaterThan(2);
      if (t.synthetic) {
        const s = t.synthetic.shares;
        expect(s.pos + s.neu + s.neg + s.mixed + s.unclear).toBeCloseTo(1, 5);
      }
    }
  });

  it('seed + чтение из БД: roundtrip ключевых слов', () => {
    const { db, file } = fullDb();
    const topics = loadTopicsFromDb(db);
    expect(topics).toHaveLength(file.topics.length);
    const prices = topics.find((t) => t.topic_id === 'prices');
    expect(prices?.keywords).toContain('цен');
    expect(prices?.name).toBe('Цены');
  });
});

describe('generateSyntheticCivic', () => {
  it('детерминизм: два запуска идентичны', () => {
    const { file } = fullDb();
    const subjects = [{ geo_id: 'ru:subject:spe' }, { geo_id: 'ru:subject:mow' }];
    const months = ['2026-01', '2026-02', '2026-03'];
    const a = generateSyntheticCivic(file, subjects, months);
    const b = generateSyntheticCivic(file, subjects, months);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('согласованность mix и только строки субъектов', () => {
    const { file } = fullDb();
    const subjects = [{ geo_id: 'ru:subject:spe' }, { geo_id: 'ru:subject:mow' }];
    const rows = generateSyntheticCivic(file, subjects, ['2026-01']);
    for (const r of rows) {
      expect(r.n_messages).toBe(r.n_positive + r.n_neutral + r.n_negative + r.n_mixed + r.n_unclear);
      expect(r.n_messages).toBeGreaterThan(0);
      expect(['ru:subject:spe', 'ru:subject:mow']).toContain(r.geo_id);
      // ФО/страна не генерируются внутри — только через aggregateCivicUp
      expect(r.geo_id.startsWith('ru:')).toBe(true);
    }
  });
});

describe('aggregateCivicUp', () => {
  it('ФО и страна = суммы по членам (согласованность уровней)', () => {
    const { file } = fullDb();
    const subjects = [{ geo_id: 'ru:subject:spe' }, { geo_id: 'ru:subject:mow' }];
    const months = ['2026-01', '2026-02'];
    const subj = generateSyntheticCivic(file, subjects, months);
    const country = aggregateCivicUp(subj, [{ geo_id: 'RU', members: ['ru:subject:spe', 'ru:subject:mow'] }]);
    for (const topic of file.topics.filter((t) => t.synthetic)) {
      for (const period of months) {
        const sum = subj
          .filter((r) => r.topic_id === topic.topic_id && r.period === period)
          .reduce((a, r) => a + r.n_messages, 0);
        const cRow = country.find((r) => r.geo_id === 'RU' && r.topic_id === topic.topic_id && r.period === period);
        if (sum === 0) {
          expect(cRow).toBeUndefined();
        } else {
          expect(cRow?.n_messages).toBe(sum);
        }
      }
    }
    // mix по части тоже суммируется согласованно
    for (const r of country) {
      expect(r.n_messages).toBe(r.n_positive + r.n_neutral + r.n_negative + r.n_mixed + r.n_unclear);
    }
  });
});

describe('storeCivicAggregates', () => {
  it('idempotency: повторная запись не дублирует строки', () => {
    const { db } = fullDb();
    const rows = [row('ru:subject:spe', 'prices', '2026-01', 40, { pos: 4, neu: 12, neg: 20, mixed: 3, unclear: 1 })];
    const opts = { sourceId: 'synthetic-civic', methodRef: 'test' };
    storeCivicAggregates(db, rows, opts);
    const n1 = (db.prepare('SELECT COUNT(*) AS n FROM civic_aggregates').get() as { n: number }).n;
    storeCivicAggregates(db, rows.map((r) => ({ ...r, n_positive: 5, n_negative: 19 })), opts);
    const n2 = (db.prepare('SELECT COUNT(*) AS n FROM civic_aggregates').get() as { n: number }).n;
    expect(n1).toBe(1);
    expect(n2).toBe(1);
    const updated = db
      .prepare('SELECT n_positive, n_negative FROM civic_aggregates WHERE geo_id = ?')
      .get('ru:subject:spe') as { n_positive: number; n_negative: number };
    expect(updated.n_positive).toBe(5);
    expect(updated.n_negative).toBe(19);
  });

  it('CHECK-страж: строка с несходящейся суммой mix отклоняется схемой', () => {
    const { db } = fullDb();
    expect(() =>
      storeCivicAggregates(
        db,
        [row('ru:subject:spe', 'prices', '2026-01', 40, { pos: 4, neu: 12, neg: 20, mixed: 3, unclear: 2 })],
        { sourceId: 'synthetic-civic', methodRef: 'test' }
      )
    ).toThrow();
  });

  it('syntheticCivicPresent после записи synthetic-civic', () => {
    const { db } = fullDb();
    expect(syntheticCivicPresent(db)).toBe(false);
    storeCivicAggregates(db, [row('ru:subject:spe', 'prices', '2026-01', 40, { neu: 40 })], {
      sourceId: 'synthetic-civic',
      methodRef: 'test'
    });
    expect(syntheticCivicPresent(db)).toBe(true);
  });
});

describe('getCivicOverview', () => {
  it('без данных → null', () => {
    const { db } = fullDb();
    expect(getCivicOverview(db, 'ru:subject:spe')).toBeNull();
  });

  it('классификация rising / declining / new / stable + insufficient при n < k_min', () => {
    const { db } = fullDb();
    const g = 'ru:subject:spe';
    const rows = [
      // rising: prev3 90 → last3 120 (+33%)
      row(g, 'prices', '2026-01', 30, { neu: 30 }),
      row(g, 'prices', '2026-02', 30, { neu: 30 }),
      row(g, 'prices', '2026-03', 30, { neu: 30 }),
      row(g, 'prices', '2026-04', 40, { neu: 40 }),
      row(g, 'prices', '2026-05', 40, { neu: 40 }),
      row(g, 'prices', '2026-06', 40, { neu: 40 }),
      // declining: prev3 120 → last3 90 (−25%)
      row(g, 'utilities', '2026-01', 40, { neg: 40 }),
      row(g, 'utilities', '2026-02', 40, { neg: 40 }),
      row(g, 'utilities', '2026-03', 40, { neg: 40 }),
      row(g, 'utilities', '2026-04', 30, { neg: 30 }),
      row(g, 'utilities', '2026-05', 30, { neg: 30 }),
      row(g, 'utilities', '2026-06', 30, { neg: 30 }),
      // new: активна только в последних 3 месяцах
      row(g, 'peace', '2026-05', 50, { neu: 50 }),
      row(g, 'peace', '2026-06', 60, { neu: 60 }),
      // stable + insufficient: равномерно мало (по 2 в месяц)
      ...['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map(
        (p) => row(g, 'ecology', p, 2, { neu: 2 })
      )
    ];
    storeCivicAggregates(db, rows, { sourceId: 'synthetic-civic', methodRef: 'test' });

    const ov = getCivicOverview(db, g, { endPeriod: '2026-06' });
    expect(ov).not.toBeNull();
    expect(ov?.window_months).toBe(12);
    expect(ov?.k_min).toBe(30);
    expect(ov?.data_mode).toBe('SYNTHETIC');

    const byId = new Map(ov!.topics.map((t) => [t.topic_id, t]));
    expect(byId.get('prices')?.classification).toBe('rising');
    expect(byId.get('prices')?.growth_pct).toBeCloseTo(33.33, 1);
    expect(byId.get('utilities')?.classification).toBe('declining');
    expect(byId.get('peace')?.classification).toBe('new');
    expect(byId.get('peace')?.insufficient).toBe(false);
    const eco = byId.get('ecology');
    expect(eco?.insufficient).toBe(true);
    expect(eco?.classification).toBe('stable');
    // 12 месячных точек на тему, окна last3/prev3
    expect(byId.get('prices')?.months).toHaveLength(12);
    expect(byId.get('prices')?.last3_n).toBe(120);
    expect(byId.get('prices')?.prev3_n).toBe(90);
    // темы без данных не попадают в выдачу
    expect(byId.has('healthcare')).toBe(false);
    // сортировка по убыванию last3_n
    const order = ov!.topics.map((t) => t.last3_n);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it('окно ограничено 3…36 месяцами', () => {
    const { db } = fullDb();
    storeCivicAggregates(db, [row('ru:subject:spe', 'prices', '2026-06', 40, { neu: 40 })], {
      sourceId: 'synthetic-civic',
      methodRef: 'test'
    });
    expect(getCivicOverview(db, 'ru:subject:spe', { months: 100, endPeriod: '2026-06' })?.window_months).toBe(36);
    expect(getCivicOverview(db, 'ru:subject:spe', { months: 1, endPeriod: '2026-06' })?.window_months).toBe(3);
  });

  it('данные по.geo без агрегатов → null даже при наличии данных в других geo', () => {
    const { db } = fullDb();
    storeCivicAggregates(db, [row('ru:subject:mow', 'prices', '2026-06', 40, { neu: 40 })], {
      sourceId: 'synthetic-civic',
      methodRef: 'test'
    });
    expect(getCivicOverview(db, 'ru:subject:spe')).toBeNull();
    expect(getCivicOverview(db, 'ru:subject:mow')?.total_last3).toBe(40);
  });
});
