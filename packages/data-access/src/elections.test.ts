import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  seedGeography,
  loadRfGeoFile,
  loadElectionsFile,
  seedElections,
  listElections,
  getElection,
  getYablokoFederalHistory,
  getRegionalElections,
  listElectionCandidates,
  validateElectionConsistency,
  syntheticMetricsPresent
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const electionsPath = resolve(process.cwd(), 'datasets/elections/elections.json');
const SOURCE = 'synthetic-elections';

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  seedElections(db, loadElectionsFile(electionsPath), { sourceId: SOURCE, dataMode: 'SYNTHETIC' });
  return db;
}

describe('seed выборов', () => {
  it('11 выборов (8 федеральных ГД + 3 региональных), 11 результатов, 11 turnout', () => {
    const db = fullDb();
    expect(listElections(db)).toHaveLength(11);
    expect(listElections(db, { level: 'federal' })).toHaveLength(8);
    expect(listElections(db, { regionGeoId: 'ru:subject:spe' })).toHaveLength(1);
    const det = getElection(db, 'ru-gd-2021');
    expect(det?.results).toHaveLength(1);
    expect(det?.turnout).not.toBeNull();
    expect(det?.data_mode).toBe('SYNTHETIC');
  });

  it('idempotency: повторный сид не дублирует строки', () => {
    const db = fullDb();
    seedElections(db, loadElectionsFile(electionsPath), { sourceId: SOURCE, dataMode: 'SYNTHETIC' });
    expect(listElections(db)).toHaveLength(11);
    const nRes = (db.prepare('SELECT COUNT(*) AS n FROM election_results').get() as { n: number }).n;
    expect(nRes).toBe(11);
  });

  it('схема: миграция 006 применена, колонок предсказаний нет', () => {
    const db = fullDb();
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const table of ['elections', 'election_results', 'election_candidates', 'election_turnout']) {
      const names = cols(table).join(',');
      for (const banned of ['predict', 'probabilit', 'win_chance', 'support_forecast']) {
        expect(names.toLowerCase()).not.toContain(banned);
      }
    }
  });
});

describe('DoD: согласованность сумм и процентов', () => {
  it('validateElectionConsistency: 0 ошибок по всему сиду', () => {
    const db = fullDb();
    const report = validateElectionConsistency(db);
    expect(report.elections_checked).toBe(11);
    expect(report.results_checked).toBe(11);
    expect(report.turnout_checked).toBe(11);
    expect(report.errors).toEqual([]);
  });

  it('CHECK-стражи: явка > 100% и ballots > voters отклоняются схемой', () => {
    const db = fullDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO election_turnout (turnout_id, election_id, voters_registered, ballots_cast, percent,
           official_source_id, created_at, updated_at)
           VALUES ('bad-1', 'ru-gd-2021', 100, 150, 150, 'synthetic-elections', 'x', 'x')`
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO election_results (result_id, election_id, party_name, votes, percent,
           official_source_id, created_at, updated_at)
           VALUES ('bad-2', 'ru-gd-2021', 'X', 100, 150, 'synthetic-elections', 'x', 'x')`
        )
        .run()
    ).toThrow();
  });
});

describe('DoD: каждая строка ссылается на официальный источник', () => {
  it('все results/turnout/elections имеют source_id из реестра источников', () => {
    const db = fullDb();
    const orphan = db
      .prepare(
        `SELECT COUNT(*) AS n FROM election_results r
         LEFT JOIN sources s ON s.source_id = r.official_source_id WHERE s.source_id IS NULL`
      )
      .get() as { n: number };
    expect(orphan.n).toBe(0);
    const orphanT = db
      .prepare(
        `SELECT COUNT(*) AS n FROM election_turnout t
         LEFT JOIN sources s ON s.source_id = t.official_source_id WHERE s.source_id IS NULL`
      )
      .get() as { n: number };
    expect(orphanT.n).toBe(0);
    const source = db
      .prepare(`SELECT reliability_metadata, collection_method FROM sources WHERE source_id = ?`)
      .get(SOURCE) as { reliability_metadata: string; collection_method: string };
    expect(JSON.parse(source.reliability_metadata).grade).toBe('D');
    expect(source.collection_method).toBe('deterministic_seed');
    // каждый результат помечен SYNTHETIC и UNVERIFIED до импорта ЦИК
    const flags = db
      .prepare(
        `SELECT COUNT(*) AS n FROM election_results WHERE data_mode != 'SYNTHETIC' OR verification_status != 'UNVERIFIED'`
      )
      .get() as { n: number };
    expect(flags.n).toBe(0);
  });
});

describe('чтение: история ЯБЛОКО и регионы', () => {
  it('федеральная история: 8 точек хронологично, барьер 5% верен (1993–1999 прошёл, 2003+ нет)', () => {
    const db = fullDb();
    const h = getYablokoFederalHistory(db);
    expect(h).toHaveLength(8);
    expect(h[0]?.election_date).toBe('1993-12-12');
    expect(h[h.length - 1]?.election_date).toBe('2021-09-19');
    expect(h[0]?.passed_barrier).toBe(true);
    expect(h[2]?.passed_barrier).toBe(true); // 1999: 5.93%
    expect(h[3]?.passed_barrier).toBe(false); // 2003: 4.3%
    expect(h[h.length - 1]?.passed_barrier).toBe(false); // 2021: 1.34%
    // проценты в пределах 0..100
    for (const p of h) {
      expect(p.percent === null || (p.percent >= 0 && p.percent <= 100)).toBe(true);
    }
  });

  it('региональная история: СПб/Псков/МГД, фильтр по региону', () => {
    const db = fullDb();
    const all = getRegionalElections(db);
    expect(all).toHaveLength(3);
    const spb = getRegionalElections(db, 'ru:subject:spe');
    expect(spb).toHaveLength(1);
    expect(spb[0]?.election_id).toBe('spb-zaks-2021');
    expect(spb[0]?.yabloko_seats).toBeGreaterThan(0);
    expect(spb[0]?.turnout_percent).not.toBeNull();
  });

  it('кандидаты: seed пуст (персоналии не выдумываются), фильтр работает', () => {
    const db = fullDb();
    expect(listElectionCandidates(db)).toHaveLength(0);
    expect(listElectionCandidates(db, { yablokoOnly: true })).toHaveLength(0);
  });

  it('детерминизм: повторный сид даёт идентичные значения', () => {
    const db = fullDb();
    const before = getElection(db, 'ru-gd-1993');
    seedElections(db, loadElectionsFile(electionsPath), { sourceId: SOURCE });
    const after = getElection(db, 'ru-gd-1993');
    expect(after?.results[0]?.votes).toBe(before?.results[0]?.votes);
    expect(after?.turnout?.valid_ballots).toBe(before?.turnout?.valid_ballots);
  });

  it('не влияет на другие подсистемы (metrics present)', () => {
    const db = fullDb();
    expect(syntheticMetricsPresent(db)).toBe(false);
  });
});
