import { describe, expect, it } from 'vitest';
import {
  computeRegistryTimeline,
  currentPosition,
  registryStats
} from './registry.js';
import type { PartyPositionRecord } from './types.js';

function pos(
  id: string,
  topic: string,
  dateFrom: string,
  dateTo: string | null,
  verification: PartyPositionRecord['verification_status'] = 'VERIFIED'
): PartyPositionRecord {
  return {
    position_id: id,
    topic,
    exact_position: `Позиция ${id}`,
    date_from: dateFrom,
    date_from_precision: 'day',
    date_to: dateTo,
    source_id: 'test-source',
    party_document_id: null,
    confidence: 'HIGH',
    statement_category: 'OFFICIAL_PARTY_STATEMENT',
    verification_status: verification
  };
}

describe('computeRegistryTimeline', () => {
  it('единственная верифицированная позиция — CURRENT', () => {
    const r = computeRegistryTimeline([pos('a', 'Т', '2020-01-01', null)], '2026-09-24');
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]?.current_status).toBe('CURRENT');
    expect(r.conflicts).toHaveLength(0);
  });

  it('последовательные позиции: прежняя EXPIRED после date_to', () => {
    const r = computeRegistryTimeline(
      [pos('a', 'Т', '2020-01-01', '2024-12-31'), pos('b', 'Т', '2025-01-01', null)],
      '2026-09-24'
    );
    const a = r.positions.find((p) => p.position_id === 'a');
    const b = r.positions.find((p) => p.position_id === 'b');
    expect(a?.current_status).toBe('EXPIRED');
    expect(b?.current_status).toBe('CURRENT');
  });

  it('перекрытие: новая позиция замещает прежнюю (SUPERSEDED), прежняя сохраняется', () => {
    const r = computeRegistryTimeline(
      [pos('a', 'Т', '2020-01-01', null), pos('b', 'Т', '2023-05-01', null)],
      '2026-09-24'
    );
    const a = r.positions.find((p) => p.position_id === 'a');
    const b = r.positions.find((p) => p.position_id === 'b');
    expect(a?.current_status).toBe('SUPERSEDED');
    expect(a?.superseded_by).toBe('b');
    expect(a?.effective_to).toBe('2023-05-01');
    expect(b?.current_status).toBe('CURRENT');
    // История не удаляется.
    expect(r.positions).toHaveLength(2);
  });

  it('не перекрывающая новую позицию не замещает прежнюю', () => {
    // a: 2020..2022; b: 2024.. — a должна стать EXPIRED, а не SUPERSEDED.
    const r = computeRegistryTimeline(
      [pos('a', 'Т', '2020-01-01', '2022-12-31'), pos('b', 'Т', '2024-01-01', null)],
      '2026-09-24'
    );
    const a = r.positions.find((p) => p.position_id === 'a');
    expect(a?.current_status).toBe('EXPIRED');
    expect(a?.superseded_by).toBeNull();
  });

  it('date_to включительно: позиция действует в дату date_to', () => {
    const r = computeRegistryTimeline(
      [pos('a', 'Т', '2020-01-01', '2024-12-31')],
      '2024-12-31'
    );
    expect(r.positions[0]?.current_status).toBe('CURRENT');
  });

  it('будущая позиция — FUTURE, не актуальна', () => {
    const r = computeRegistryTimeline([pos('a', 'Т', '2027-01-01', null)], '2026-09-24');
    expect(r.positions[0]?.current_status).toBe('FUTURE');
  });

  it('неверифицированная актуальная позиция — UNVERIFIED', () => {
    const r = computeRegistryTimeline(
      [pos('a', 'Т', '2026-01-01', null, 'UNVERIFIED')],
      '2026-09-24'
    );
    expect(r.positions[0]?.current_status).toBe('UNVERIFIED');
  });

  it('одинаковые date_from: детерминированный порядок + конфликт зафиксирован', () => {
    const r = computeRegistryTimeline(
      [pos('b', 'Т', '2026-01-01', null), pos('a', 'Т', '2026-01-01', null)],
      '2026-09-24'
    );
    // Детерминизм: по position_id — 'a' актуальна, 'b' SUPERSEDED.
    const a = r.positions.find((p) => p.position_id === 'a');
    const b = r.positions.find((p) => p.position_id === 'b');
    expect(a?.current_status).toBe('SUPERSEDED');
    expect(b?.current_status).toBe('CURRENT');
    expect(r.conflicts.some((c) => c.kind === 'overlap_same_start')).toBe(true);
  });

  it('разные темы не влияют друг на друга', () => {
    const r = computeRegistryTimeline(
      [pos('a', 'Т1', '2020-01-01', null), pos('b', 'Т2', '2023-01-01', null)],
      '2026-09-24'
    );
    expect(r.positions.every((p) => p.current_status === 'CURRENT')).toBe(true);
    expect(r.conflicts).toHaveLength(0);
  });
});

describe('currentPosition', () => {
  it('возвращает актуальную позицию темы', () => {
    const list = [
      pos('a', 'Мир', '2020-01-01', null),
      pos('b', 'Мир', '2026-01-01', null),
      pos('c', 'Экология', '2026-01-01', null)
    ];
    const cur = currentPosition(list, 'Мир', '2026-09-24');
    expect(cur?.position_id).toBe('b');
  });

  it('возвращает UNVERIFIED-позицию, если верифицированной нет (не скрывает)', () => {
    const list = [pos('a', 'Мир', '2026-01-01', null, 'UNVERIFIED')];
    const cur = currentPosition(list, 'Мир', '2026-09-24');
    expect(cur?.current_status).toBe('UNVERIFIED');
  });

  it('null, если действующих позиций темы нет', () => {
    const list = [pos('a', 'Мир', '2020-01-01', '2021-01-01')];
    expect(currentPosition(list, 'Мир', '2026-09-24')).toBeNull();
    expect(currentPosition(list, 'Экология', '2026-09-24')).toBeNull();
  });
});

describe('registryStats', () => {
  it('считает статусы и темы', () => {
    const r = computeRegistryTimeline(
      [
        pos('a', 'Т4', '2020-01-01', null, 'UNVERIFIED'),
        pos('b', 'Т1', '2026-01-01', null),
        pos('c', 'Т2', '2020-01-01', '2021-01-01'),
        pos('d', 'Т3', '2027-01-01', null)
      ],
      '2026-09-24'
    );
    const s = registryStats(r);
    expect(s.total).toBe(4);
    expect(s.current).toBe(1); // b
    expect(s.unverified).toBe(1); // a (Т4, не верифицирована, не замещена)
    expect(s.superseded).toBe(0);
    expect(s.expired).toBe(1); // c
    expect(s.future).toBe(1); // d
    expect(s.topics).toBe(4);
  });
});
