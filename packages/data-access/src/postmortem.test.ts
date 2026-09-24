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
  loadPostmortemBlocks,
  seedPostmortemBlocks,
  getPostmortem,
  getElectionPhase
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const electionsPath = resolve(process.cwd(), 'datasets/elections/elections.json');
const postmortemPath = resolve(process.cwd(), 'datasets/elections/postmortem.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  seedElections(db, loadElectionsFile(electionsPath), { sourceId: 'synthetic-elections' });
  seedPostmortemBlocks(db, loadPostmortemBlocks(postmortemPath));
  return db;
}

describe('getElectionPhase (авто-переключение режима)', () => {
  it('границы: до / день / после', () => {
    expect(getElectionPhase('2026-09-20', '2026-09-19')).toBe('pre');
    expect(getElectionPhase('2026-09-20', '2026-09-20')).toBe('election_day');
    expect(getElectionPhase('2026-09-20', '2026-09-21')).toBe('postmortem');
    expect(getElectionPhase('2026-09-20', '2026-10-05')).toBe('postmortem');
  });

  it('фаза не зависит от времени суток (даты срезаются)', () => {
    expect(getElectionPhase('2026-09-20T07:00:00Z', '2026-09-20T23:59:00Z')).toBe('election_day');
  });
});

describe('getPostmortem: ГД-2026 (выборы завершены, официальных результатов нет)', () => {
  const NOW = '2026-09-24T12:00:00Z';

  it('фаза postmortem, 4 блока в фиксированном порядке', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW });
    expect(pm).not.toBeNull();
    expect(pm!.phase).toBe('postmortem');
    expect(pm!.election.days_since_election).toBe(4);
    expect(pm!.election.previous_election_id).toBe('ru-gd-2021');
    expect(pm!.blocks.map((b) => b.kind)).toEqual([
      'official_result',
      'party_interpretation',
      'independent_analysis',
      'model_inference'
    ]);
  });

  it('OFFICIAL RESULT: insufficient с явным «не моделируются», строк нет', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW })!;
    const b = pm.blocks.find((x) => x.kind === 'official_result')!;
    expect(b.status).toBe('insufficient_data');
    expect(b.rows).toHaveLength(0);
    expect(b.note).toContain('не внесены');
    expect(b.note).toContain('не моделируются');
  });

  it('PARTY INTERPRETATION: только OFFICIAL PARTY STATEMENT, ни одного числа результата', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW })!;
    const b = pm.blocks.find((x) => x.kind === 'party_interpretation')!;
    expect(b.status).toBe('ready');
    expect(b.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of b.rows) {
      expect(r.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
      expect(r.votes).toBeNull();
      expect(r.percent).toBeNull();
      expect(r.seats).toBeNull();
      expect(r.source_id).toBe('initial-context');
    }
    const joined = b.rows.map((r) => r.value ?? '').join(' ');
    expect(joined).toContain('За мир и свободу');
    expect(joined).toContain('За жизнь без страха');
  });

  it('INDEPENDENT ANALYSIS: честный INSUFFICIENT (не заполняется моделью)', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW })!;
    const b = pm.blocks.find((x) => x.kind === 'independent_analysis')!;
    expect(b.status).toBe('insufficient_data');
    expect(b.rows).toHaveLength(0);
    expect(b.note).toContain('моделью не заполняются');
  });

  it('MODEL INFERENCE: недостаточно данных (прогнозы не строятся), но методология с базой 2021', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW })!;
    const b = pm.blocks.find((x) => x.kind === 'model_inference')!;
    expect(b.status).toBe('insufficient_data');
    expect(b.rows).toHaveLength(0);
    expect(b.methodology).toContain('2021-09-19');
    expect(b.note).toContain('прогнозы');
  });

  it('СТРАЖ несмешиваемости: PARTY-строки без чисел результатов; MODEL всегда помечен; OFFICIAL всегда с источником', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2026', { now: NOW })!;
    for (const b of pm.blocks) {
      for (const r of b.rows) {
        if (b.kind === 'party_interpretation') {
          expect(r.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
          expect(r.votes === null && r.percent === null && r.seats === null).toBe(true);
        }
        if (b.kind === 'model_inference') {
          expect(r.statement_category).toBe('MODEL');
          expect(b.methodology).toContain('Не официальный результат');
        }
        if (b.kind === 'official_result') {
          expect(r.source_id).not.toBeNull();
          expect(r.statement_category).toBe('FACT');
        }
      }
    }
  });
});

describe('getPostmortem: ГД-2021 (заполненный postmortem)', () => {
  const NOW = '2026-09-24T12:00:00Z';

  it('OFFICIAL RESULT ready (SYNTHETIC-оговорка), MODEL INFERENCE: динамика −0.65 п.п., мандаты +3, явка +3.8', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2021', { now: NOW })!;
    const off = pm.blocks.find((b) => b.kind === 'official_result')!;
    expect(off.status).toBe('ready');
    expect(off.rows.length).toBeGreaterThanOrEqual(2); // результат + явка
    expect(off.note).toContain('SYNTHETIC');

    const model = pm.blocks.find((b) => b.kind === 'model_inference')!;
    expect(model.status).toBe('ready');
    const pct = model.rows.find((r) => r.label.includes('Доля по спискам'));
    expect(pct?.delta_pp).toBeCloseTo(-0.65, 2); // 1.34 − 1.99
    const seats = model.rows.find((r) => r.label.includes('Мандаты'));
    expect(seats?.delta_pp).toBe(3); // 4 − 1
    const turnout = model.rows.find((r) => r.label.includes('Явка'));
    expect(turnout?.delta_pp).toBeCloseTo(3.8, 1); // 51.7 − 47.9
    expect(model.methodology).toContain('2016-09-18');
    expect(model.methodology).toContain('SYNTHETIC');
  });

  it('party_interpretation для ГД-2021 честно пуст (заявления не вносились)', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2021', { now: NOW })!;
    const b = pm.blocks.find((x) => x.kind === 'party_interpretation')!;
    expect(b.status).toBe('insufficient_data');
    expect(b.rows).toHaveLength(0);
  });

  it('DATA QUALITY: сводка по блокам корректна', () => {
    const db = fullDb();
    const pm = getPostmortem(db, 'ru-gd-2021', { now: NOW })!;
    expect(pm.data_quality.blocks).toHaveLength(4);
    const official = pm.data_quality.blocks.find((b) => b.kind === 'official_result');
    expect(official?.status).toBe('ready');
    // все SYNTHETIC-строки официального блока считаются unverified
    expect(pm.data_quality.unverified_rows).toBeGreaterThan(0);
    expect(pm.data_quality.note).toContain('не смешиваются');
  });

  it('детерминизм: два вызова (фикс. now) идентичны', () => {
    const db = fullDb();
    const a = getPostmortem(db, 'ru-gd-2021', { now: NOW });
    const b = getPostmortem(db, 'ru-gd-2021', { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('seedPostmortemBlocks', () => {
  it('idempotency + CHECK несмешиваемых kind', () => {
    const db = fullDb();
    seedPostmortemBlocks(db, loadPostmortemBlocks(postmortemPath));
    const n = (db.prepare('SELECT COUNT(*) AS n FROM postmortem_blocks').get() as { n: number }).n;
    expect(n).toBe(2);
    expect(() =>
      db
        .prepare(
          `INSERT INTO postmortem_blocks (block_id, election_id, block_kind, section_key, title, payload_json, created_at, updated_at)
           VALUES ('bad', 'ru-gd-2026', 'predictions', 'x', 'x', '[]', 'x', 'x')`
        )
        .run()
    ).toThrow();
  });
});
