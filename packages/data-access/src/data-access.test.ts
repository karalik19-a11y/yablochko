import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { migrate, countAppliedMigrations } from './migrations.js';
import { seedFromBundle, SeedBundle } from './seed.js';
import { getPartyContext, listPositionsComputed } from './repositories/party.js';
import { sourceCounts } from './repositories/sources.js';
import { getLastSeedAt } from './repositories/meta.js';

function testBundle() {
  return SeedBundle.parse({
    sources: [
      {
        source_id: 'test-src',
        name: 'Тестовый источник',
        source_type: 'internal_initial_context',
        reliability: { grade: 'D', note: 'тест' },
        status: 'active'
      }
    ],
    party: {
      party_id: 'yabloko',
      short_name: 'ЯБЛОКО',
      full_name: 'РОДП «ЯБЛОКО»',
      source_id: 'test-src',
      verification_status: 'UNVERIFIED'
    },
    bodies: [
      { body_id: 'fpk', name: 'ФПК', body_type: 'fpc', source_id: 'test-src' }
    ],
    leaders: [
      {
        leader_id: 'l1',
        person_name: 'Персона А',
        role_title: 'Роль А',
        source_id: 'test-src',
        confidence: 'MEDIUM'
      }
    ],
    documents: [
      {
        doc_id: 'd1',
        doc_type: 'program_provisions',
        title: 'Документ 1',
        doc_date: '2026-01-01',
        date_precision: 'year',
        source_id: 'test-src'
      }
    ],
    positions: [
      {
        position_id: 'p1',
        topic: 'Мир',
        exact_position: 'Позиция мира',
        date_from: '2026-01-01',
        date_from_precision: 'year',
        source_id: 'test-src',
        party_document_id: 'd1',
        confidence: 'MEDIUM'
      },
      {
        position_id: 'p2',
        topic: 'Мир',
        exact_position: 'Новая позиция мира',
        date_from: '2027-01-01',
        source_id: 'test-src',
        confidence: 'MEDIUM'
      }
    ],
    events: [],
    candidates: [],
    participation: []
  });
}

describe('migrations + seed', () => {
  it('миграции применяются один раз и идемпотентны', () => {
    const db = openDb(':memory:');
    const first = migrate(db);
    expect(first.appliedIds).toHaveLength(3);
    expect(countAppliedMigrations(db)).toBe(3);
    const second = migrate(db);
    expect(second.appliedIds).toHaveLength(0);
  });

  it('seed идемпотентен и записывает audit/last_seed', () => {
    const db = openDb(':memory:');
    migrate(db);
    const b = testBundle();
    const r1 = seedFromBundle(db, b);
    expect(r1.positions).toBe(2);
    const r2 = seedFromBundle(db, b);
    expect(r2.positions).toBe(2);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM party_positions')
      .get() as { n: number };
    expect(Number(rows.n)).toBe(2);
    expect(getLastSeedAt(db)).not.toBeNull();
  });

  it('отклоняет seed без обязательных полей (zod)', () => {
    expect(() =>
      SeedBundle.parse({
        positions: [{ position_id: 'x', topic: 'Т' }] // нет exact_position и др.
      })
    ).toThrow();
  });

  it('внешние ключи работают: позиция без источника отклоняется', () => {
    const db = openDb(':memory:');
    migrate(db);
    const bad = testBundle();
    bad.positions.push({
      ...bad.positions[0]!,
      position_id: 'p3',
      source_id: 'no-such-source'
    });
    expect(() => seedFromBundle(db, bad)).toThrow();
  });
});

describe('party context queries', () => {
  it('контекст собирается; позиции получают вычисленные статусы', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedFromBundle(db, testBundle());
    const { context, positionStats } = getPartyContext(db, '2026-09-24');
    expect(context.party.full_name).toContain('ЯБЛОКО');
    expect(context.leaders).toHaveLength(1);
    expect(context.latestDocuments).toHaveLength(1);

    // p1 действует в 2026 → UNVERIFIED (не верифицирован), p2 начинается в 2027 → FUTURE
    const p1 = context.currentPositions.find((p) => p.position_id === 'p1');
    const p2 = listPositionsComputed(db, '2026-09-24').find(
      (p) => p.position_id === 'p2'
    );
    expect(p1?.current_status).toBe('UNVERIFIED');
    expect(p2?.current_status).toBe('FUTURE');
    expect(positionStats.total).toBe(2);

    expect(context.candidates.count).toBe(0);
    expect(context.candidates.note).toContain('INSUFFICIENT DATA');
  });

  it('источники: статусы и счётчики', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedFromBundle(db, testBundle());
    const c = sourceCounts(db);
    expect(c.total).toBe(1);
    expect(c.active).toBe(1);
    expect(c.planned).toBe(0);
  });
});
