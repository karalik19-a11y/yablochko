/**
 * Party Position Registry — ядро Party Context Engine.
 *
 * Семантика таймлайна:
 *  - Позиции одной темы образуют шкалу по date_from.
 *  - Позднейший официальный документ имеет больший current relevance.
 *  - Новая позиция с date_from <= date_to прежней ЗАМЕНЯЕТ её (SUPERSEDED)
 *    с даты своего начала; прежняя запись сохраняется, не удаляется.
 *  - date_to — дата окончания включительно.
 *  - Если позиция не верифицирована официальным источником, её статус UNVERIFIED.
 *
 * Функции чистые: без побочных эффектов, детерминированы (детерминизм при
 * равных date_from обеспечивается сортировкой по position_id).
 */

import type {
  PartyPositionRecord,
  PartyPositionView,
  RegistryTimelineResult,
  TimelineConflict,
  PositionStatus
} from './types.js';
import { compareIsoDate } from './types.js';

/**
 * Вычисляет статусы всех позиций на дату `asOf` и находит конфликты.
 *
 * Статус позиции определяется в порядке приоритета:
 *  1. FUTURE        — date_from > asOf;
 *  2. SUPERSEDED    — существует другая позиция той же темы, начавшаяся позже
 *                     и перекрывающая данную (заменившая её);
 *  3. EXPIRED       — date_to задан и asOf > date_to (и нет заместившей записи);
 *  4. UNVERIFIED    — verification_status !== 'VERIFIED';
 *  5. CURRENT       — в остальных случаях.
 */
export function computeRegistryTimeline(
  positions: readonly PartyPositionRecord[],
  asOf: string
): RegistryTimelineResult {
  const byTopic = new Map<string, PartyPositionRecord[]>();
  for (const p of positions) {
    const list = byTopic.get(p.topic);
    if (list) list.push(p);
    else byTopic.set(p.topic, [p]);
  }

  const views: PartyPositionView[] = [];
  const conflicts: TimelineConflict[] = [];

  for (const [topic, list] of byTopic) {
    // Детерминированный порядок: по date_from, затем по position_id.
    const sorted = [...list].sort(
      (a, b) =>
        compareIsoDate(a.date_from, b.date_from) ||
        (a.position_id < b.position_id ? -1 : 1)
    );

    for (let i = 0; i < sorted.length; i++) {
      const pos = sorted[i] as PartyPositionRecord;
      let current_status: PositionStatus;
      let superseded_by: string | null = null;
      let effective_to: string | null = pos.date_to;

      if (compareIsoDate(pos.date_from, asOf) > 0) {
        current_status = 'FUTURE';
      } else {
        // Ищем заместившую позицию: начавшуюся позже (и уже вступившую в силу
        // на дату расчёта) и перекрывающую данную.
        let successor: PartyPositionRecord | null = null;
        for (let j = i + 1; j < sorted.length; j++) {
          const other = sorted[j] as PartyPositionRecord;
          const started = compareIsoDate(other.date_from, asOf) <= 0;
          const overlaps =
            pos.date_to === null || compareIsoDate(other.date_from, pos.date_to) <= 0;
          if (started && overlaps) {
            if (successor === null) successor = other;
            else {
              conflicts.push({
                topic,
                position_id_a: successor.position_id,
                position_id_b: other.position_id,
                kind: 'ambiguous_successor',
                note: `Две позиции претендуют на замещение «${pos.position_id}»; разрешено по порядку date_from/position_id, требуется проверка документа-источника.`
              });
            }
          }
        }
        if (successor !== null) {
          current_status = 'SUPERSEDED';
          superseded_by = successor.position_id;
          effective_to = successor.date_from;
        } else if (pos.date_to !== null && compareIsoDate(asOf, pos.date_to) > 0) {
          current_status = 'EXPIRED';
        } else if (pos.verification_status !== 'VERIFIED') {
          current_status = 'UNVERIFIED';
        } else {
          current_status = 'CURRENT';
        }
      }

      views.push({ ...pos, current_status, superseded_by, effective_to });
    }

    // Информационный конфликт: несколько позиций одной темы с одинаковой датой начала.
    const starts = new Map<string, PartyPositionRecord[]>();
    for (const p of sorted) {
      const arr = starts.get(p.date_from);
      if (arr) arr.push(p);
      else starts.set(p.date_from, [p]);
    }
    for (const [dateFrom, group] of starts) {
      if (group.length > 1) {
        conflicts.push({
          topic,
          position_id_a: (group[0] as PartyPositionRecord).position_id,
          position_id_b: (group[1] as PartyPositionRecord).position_id,
          kind: 'overlap_same_start',
          note: `Несколько позиций темы «${topic}» начинаются ${dateFrom}; актуальность определена детерминированно, требуется проверка документа-источника.`
        });
      }
    }
  }

  views.sort(
    (a, b) =>
      a.topic.localeCompare(b.topic, 'ru') ||
      compareIsoDate(b.date_from, a.date_from) ||
      (a.position_id < b.position_id ? -1 : 1)
  );

  conflicts.sort(
    (a, b) =>
      a.topic.localeCompare(b.topic, 'ru') ||
      (a.position_id_a < b.position_id_a ? -1 : 1)
  );

  return { positions: views, conflicts };
}

/**
 * Актуальная позиция темы на дату: последняя по шкале, действующая на asOf
 * (независимо от верификации — но со статусом UNVERIFIED, если не подтверждена).
 * Возвращает null, если действующих позиций нет.
 */
export function currentPosition(
  positions: readonly PartyPositionRecord[],
  topic: string,
  asOf: string
): PartyPositionView | null {
  const timeline = computeRegistryTimeline(positions, asOf);
  const candidates = timeline.positions.filter(
    (p) =>
      p.topic === topic &&
      p.current_status !== 'FUTURE' &&
      p.current_status !== 'EXPIRED' &&
      p.current_status !== 'SUPERSEDED'
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, p) =>
    compareIsoDate(p.date_from, latest.date_from) >= 0 ? p : latest
  );
}

/** Сводка по реестру для UI и предупреждений. */
export interface RegistryStats {
  total: number;
  current: number;
  unverified: number;
  superseded: number;
  expired: number;
  future: number;
  topics: number;
  conflicts: number;
}

export function registryStats(result: RegistryTimelineResult): RegistryStats {
  const s: RegistryStats = {
    total: result.positions.length,
    current: 0,
    unverified: 0,
    superseded: 0,
    expired: 0,
    future: 0,
    topics: new Set(result.positions.map((p) => p.topic)).size,
    conflicts: result.conflicts.length
  };
  for (const p of result.positions) {
    switch (p.current_status) {
      case 'CURRENT':
        s.current += 1;
        break;
      case 'UNVERIFIED':
        s.unverified += 1;
        break;
      case 'SUPERSEDED':
        s.superseded += 1;
        break;
      case 'EXPIRED':
        s.expired += 1;
        break;
      case 'FUTURE':
        s.future += 1;
        break;
    }
  }
  return s;
}
