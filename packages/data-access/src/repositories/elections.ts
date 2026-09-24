import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * Election Intelligence (Этап 8): база выборов с official_source у каждой
 * строки. До импорта ЦИК — SYNTHETIC-приближения (grade D, честные бейджи).
 * Колонок/полей предсказаний нет на уровне схемы и API (DoD: «нет
 * персональных предсказаний»); персональные кандидаты — только из
 * официальных списков, не выдумываются.
 */

export const ElectionsFile = z.object({
  meta: z.object({ note: z.string(), methodology: z.string(), as_of: z.string().optional() }).passthrough(),
  elections: z.array(
    z.object({
      election_id: z.string(),
      name: z.string(),
      election_date: z.string(),
      level: z.enum(['federal', 'region', 'municipal']),
      region_geo_id: z.string().nullable().default(null),
      election_type: z.string(),
      electoral_system: z.string().nullable().default(null),
      seats_total: z.number().int().nullable().default(null)
    })
  ),
  results: z
    .array(
      z.object({
        result_id: z.string(),
        election_id: z.string(),
        district_id: z.string().nullable().default(null),
        candidate_id: z.string().nullable().default(null),
        party_name: z.string().nullable().default(null),
        is_party_list: z.number().int().default(0),
        is_yabloko: z.number().int().default(0),
        votes: z.number().int().nullable().default(null),
        percent: z.number().nullable().default(null),
        seats: z.number().int().nullable().default(null)
      })
    )
    .default([]),
  turnout: z
    .array(
      z.object({
        turnout_id: z.string(),
        election_id: z.string(),
        district_id: z.string().nullable().default(null),
        voters_registered: z.number().int(),
        ballots_cast: z.number().int(),
        valid_ballots: z.number().int().nullable().default(null),
        percent: z.number()
      })
    )
    .default([]),
  districts: z.array(z.record(z.string(), z.unknown())).default([]),
  candidates: z.array(z.record(z.string(), z.unknown())).default([])
});
export type ElectionsFile = z.infer<typeof ElectionsFile>;

export function loadElectionsFile(path: string): ElectionsFile {
  return ElectionsFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

const NOW = () => new Date().toISOString();

/**
 * Сид выборов (идемпотентный upsert). votes синхронизируются с turnout:
 * votes = round(valid_ballots × percent / 100) — внутренняя согласованность,
 * покрываемая тестами (DoD: суммы/проценты).
 */
export function seedElections(
  db: Db,
  file: ElectionsFile,
  opts: { sourceId: string; dataMode?: 'SEED' | 'SYNTHETIC' | 'LIVE' }
): { elections: number; results: number; turnout: number } {
  const ts = NOW();
  const dataMode = opts.dataMode ?? 'SYNTHETIC';
  const turnoutByElection = new Map(file.turnout.map((t) => [t.election_id, t]));
  const validOf = (electionId: string): number | null => turnoutByElection.get(electionId)?.valid_ballots ?? null;

  let resultRows = 0;
  db.exec('BEGIN');
  try {
    const upElection = db.prepare(`
      INSERT INTO elections (election_id, name, election_date, level, region_geo_id, election_type,
        electoral_system, seats_total, official_source_id, data_mode, verification_status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?, ?)
      ON CONFLICT(election_id) DO UPDATE SET name=excluded.name, election_date=excluded.election_date,
        level=excluded.level, region_geo_id=excluded.region_geo_id, election_type=excluded.election_type,
        electoral_system=excluded.electoral_system, seats_total=excluded.seats_total,
        official_source_id=excluded.official_source_id, data_mode=excluded.data_mode, note=excluded.note,
        updated_at=excluded.updated_at
    `);
    for (const e of file.elections) {
      upElection.run(
        e.election_id, e.name, e.election_date, e.level, e.region_geo_id, e.election_type,
        e.electoral_system, e.seats_total, opts.sourceId, dataMode, file.meta.note, ts, ts
      );
    }

    const upResult = db.prepare(`
      INSERT INTO election_results (result_id, election_id, district_id, candidate_id, party_name,
        is_party_list, is_yabloko, votes, percent, seats, official_source_id, data_mode,
        verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(result_id) DO UPDATE SET
        votes=excluded.votes, percent=excluded.percent, seats=excluded.seats,
        official_source_id=excluded.official_source_id, data_mode=excluded.data_mode, updated_at=excluded.updated_at
    `);
    for (const r of file.results) {
      // Согласованность: если votes не задан — вычисляем из percent и valid_ballots.
      const valid = validOf(r.election_id);
      const votes =
        r.votes ??
        (r.percent !== null && valid !== null ? Math.round((valid * r.percent) / 100) : null);
      if (votes === null) continue;
      upResult.run(
        r.result_id ?? `res-${r.election_id}-${r.party_name ?? r.candidate_id ?? 'x'}`,
        r.election_id, r.district_id, r.candidate_id, r.party_name,
        r.is_party_list, r.is_yabloko, votes, r.percent, r.seats,
        opts.sourceId, dataMode, ts, ts
      );
      resultRows += 1;
    }

    const upTurnout = db.prepare(`
      INSERT INTO election_turnout (turnout_id, election_id, district_id, voters_registered,
        ballots_cast, valid_ballots, percent, official_source_id, data_mode, verification_status,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(turnout_id) DO UPDATE SET voters_registered=excluded.voters_registered,
        ballots_cast=excluded.ballots_cast, valid_ballots=excluded.valid_ballots,
        percent=excluded.percent, official_source_id=excluded.official_source_id,
        data_mode=excluded.data_mode, updated_at=excluded.updated_at
    `);
    for (const t of file.turnout) {
      upTurnout.run(
        t.turnout_id ?? `to-${t.election_id}-${t.district_id ?? 'all'}`,
        t.election_id, t.district_id, t.voters_registered, t.ballots_cast, t.valid_ballots,
        t.percent, opts.sourceId, dataMode, ts, ts
      );
    }

    // Участие партии и кандидаты: только из официальных записей (тут — пусто).
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'elections_seed', 'elections', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ elections: file.elections.length, results: resultRows, turnout: file.turnout.length }));

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { elections: file.elections.length, results: resultRows, turnout: file.turnout.length };
}

// ---------- Чтение ----------

export interface ElectionRow {
  election_id: string;
  name: string;
  election_date: string;
  level: string;
  region_geo_id: string | null;
  election_type: string;
  electoral_system: string | null;
  seats_total: number | null;
  official_source_id: string;
  data_mode: string;
  verification_status: string;
  note: string | null;
}

export function listElections(db: Db, filter: { level?: string; regionGeoId?: string } = {}): ElectionRow[] {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  if (filter.level) {
    conds.push('level = ?');
    params.push(filter.level);
  }
  if (filter.regionGeoId) {
    conds.push('region_geo_id = ?');
    params.push(filter.regionGeoId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM elections ${where} ORDER BY election_date DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    election_id: String(r.election_id),
    name: String(r.name),
    election_date: String(r.election_date),
    level: String(r.level),
    region_geo_id: (r.region_geo_id as string | null) ?? null,
    election_type: String(r.election_type),
    electoral_system: (r.electoral_system as string | null) ?? null,
    seats_total: (r.seats_total as number | null) ?? null,
    official_source_id: String(r.official_source_id),
    data_mode: String(r.data_mode),
    verification_status: String(r.verification_status),
    note: (r.note as string | null) ?? null
  }));
}

export interface ElectionResultRow {
  result_id: string;
  district_id: string | null;
  party_name: string | null;
  is_party_list: number;
  is_yabloko: number;
  votes: number;
  percent: number | null;
  seats: number | null;
}

export interface ElectionTurnoutRow {
  voters_registered: number;
  ballots_cast: number;
  valid_ballots: number | null;
  percent: number;
}

export interface ElectionDetail extends ElectionRow {
  results: ElectionResultRow[];
  turnout: ElectionTurnoutRow | null;
  provenance: {
    source_id: string;
    data_mode: string;
    verification_status: string;
    caveats: string[];
  };
}

export function getElection(db: Db, electionId: string): ElectionDetail | null {
  const rows = db.prepare(`SELECT * FROM elections WHERE election_id = ?`).all(electionId) as Array<
    Record<string, unknown>
  >;
  const e = rows[0];
  if (!e) return null;
  const results = (
    db
      .prepare(
        `SELECT result_id, district_id, party_name, is_party_list, is_yabloko, votes, percent, seats
         FROM election_results WHERE election_id = ? ORDER BY votes DESC`
      )
      .all(electionId) as Array<Record<string, unknown>>
  ).map((r) => ({
    result_id: String(r.result_id),
    district_id: (r.district_id as string | null) ?? null,
    party_name: (r.party_name as string | null) ?? null,
    is_party_list: Number(r.is_party_list),
    is_yabloko: Number(r.is_yabloko),
    votes: Number(r.votes),
    percent: (r.percent as number | null) ?? null,
    seats: (r.seats as number | null) ?? null
  }));
  const t =
    (
      db
        .prepare(
          `SELECT voters_registered, ballots_cast, valid_ballots, percent FROM election_turnout
           WHERE election_id = ? AND district_id IS NULL`
        )
        .get(electionId) as Record<string, unknown> | undefined
    ) ?? null;
  const caveats: string[] = [];
  if (String(e.data_mode) === 'SYNTHETIC') {
    caveats.push('Числовые значения — SYNTHETIC-приближения (grade D), не официальные данные ЦИК; заменяются при импорте.');
  }
  caveats.push('Статус UNVERIFIED: требуется сверка с официальным протоколом ЦИК/избиркома.');
  caveats.push('Результаты — агрегированная статистика выборов; предсказания и персональные вероятности отсутствуют.');
  return {
    election_id: String(e.election_id),
    name: String(e.name),
    election_date: String(e.election_date),
    level: String(e.level),
    region_geo_id: (e.region_geo_id as string | null) ?? null,
    election_type: String(e.election_type),
    electoral_system: (e.electoral_system as string | null) ?? null,
    seats_total: (e.seats_total as number | null) ?? null,
    official_source_id: String(e.official_source_id),
    data_mode: String(e.data_mode),
    verification_status: String(e.verification_status),
    note: (e.note as string | null) ?? null,
    results,
    turnout: t
      ? {
          voters_registered: Number(t.voters_registered),
          ballots_cast: Number(t.ballots_cast),
          valid_ballots: t.valid_ballots === null ? null : Number(t.valid_ballots),
          percent: Number(t.percent)
        }
      : null,
    provenance: {
      source_id: String(e.official_source_id),
      data_mode: String(e.data_mode),
      verification_status: String(e.verification_status),
      caveats
    }
  };
}

export interface YablokoHistoryPoint {
  election_id: string;
  name: string;
  election_date: string;
  percent: number | null;
  votes: number | null;
  seats: number | null;
  passed_barrier: boolean | null;
  data_mode: string;
}

/** Федеральная история ЯБЛОКО (партийные списки ГД), старые → новые. */
export function getYablokoFederalHistory(db: Db): YablokoHistoryPoint[] {
  const rows = db
    .prepare(
      `SELECT e.election_id, e.name, e.election_date, e.data_mode, r.percent, r.votes, r.seats
       FROM election_results r JOIN elections e ON e.election_id = r.election_id
       WHERE r.is_yabloko = 1 AND r.is_party_list = 1 AND e.level = 'federal'
       ORDER BY e.election_date ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const percent = (r.percent as number | null) ?? null;
    return {
      election_id: String(r.election_id),
      name: String(r.name),
      election_date: String(r.election_date),
      percent,
      votes: (r.votes as number | null) ?? null,
      seats: (r.seats as number | null) ?? null,
      passed_barrier: percent === null ? null : percent >= 5,
      data_mode: String(r.data_mode)
    };
  });
}

export interface RegionalElectionRow {
  election_id: string;
  name: string;
  election_date: string;
  region_geo_id: string | null;
  yabloko_percent: number | null;
  yabloko_seats: number | null;
  seats_total: number | null;
  turnout_percent: number | null;
  data_mode: string;
}

/** Региональная история выборов (региональные уровни, все партии — сводка ЯБЛОКО). */
export function getRegionalElections(db: Db, regionGeoId?: string): RegionalElectionRow[] {
  const rows = (
    regionGeoId
      ? db.prepare(`SELECT * FROM elections WHERE level = 'region' AND region_geo_id = ? ORDER BY election_date DESC`).all(regionGeoId)
      : db.prepare(`SELECT * FROM elections WHERE level = 'region' ORDER BY election_date DESC`).all()
  ) as Array<Record<string, unknown>>;
  return rows.map((e) => {
    const id = String(e.election_id);
    const y = db
      .prepare(
        `SELECT percent, seats FROM election_results WHERE election_id = ? AND is_yabloko = 1 ORDER BY votes DESC LIMIT 1`
      )
      .get(id) as { percent: number | null; seats: number | null } | undefined;
    const t = db
      .prepare(`SELECT percent FROM election_turnout WHERE election_id = ? AND district_id IS NULL`)
      .get(id) as { percent: number } | undefined;
    return {
      election_id: id,
      name: String(e.name),
      election_date: String(e.election_date),
      region_geo_id: (e.region_geo_id as string | null) ?? null,
      yabloko_percent: y?.percent ?? null,
      yabloko_seats: y?.seats ?? null,
      seats_total: (e.seats_total as number | null) ?? null,
      turnout_percent: t?.percent ?? null,
      data_mode: String(e.data_mode)
    };
  });
}

export interface ElectionCandidateRow {
  candidate_id: string;
  election_id: string;
  district_id: string | null;
  person_name: string;
  party_name: string | null;
  is_yabloko: boolean;
  registration_status: string | null;
  verification_status: string;
}

/** Кандидаты — ТОЛЬКО из официальных списков (seed пуст, пока нет импорта). */
export function listElectionCandidates(
  db: Db,
  filter: { electionId?: string; yablokoOnly?: boolean } = {}
): ElectionCandidateRow[] {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  if (filter.electionId) {
    conds.push('election_id = ?');
    params.push(filter.electionId);
  }
  if (filter.yablokoOnly) conds.push('is_yabloko = 1');
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM election_candidates ${where} ORDER BY person_name LIMIT 500`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    candidate_id: String(r.candidate_id),
    election_id: String(r.election_id),
    district_id: (r.district_id as string | null) ?? null,
    person_name: String(r.person_name),
    party_name: (r.party_name as string | null) ?? null,
    is_yabloko: Number(r.is_yabloko) === 1,
    registration_status: (r.registration_status as string | null) ?? null,
    verification_status: String(r.verification_status)
  }));
}

// ---------- Валидация согласованности (DoD-тесты) ----------

export interface ConsistencyReport {
  elections_checked: number;
  results_checked: number;
  turnout_checked: number;
  errors: string[];
}

/**
 * Проверки сумм/процентов:
 *  1) turnout: ballots_cast ≤ voters_registered; percent ≈ cast/registered×100 (±0.5);
 *  2) votes ≈ valid_ballots × percent / 100 (±1% — округления);
 *  3) сумма percent списков одного выбора не превышает 100 (+погрешность 0.5);
 *  4) сумма мест по результатам выбора ≤ seats_total.
 */
export function validateElectionConsistency(db: Db): ConsistencyReport {
  const errors: string[] = [];
  const elections = db.prepare(`SELECT election_id, seats_total FROM elections`).all() as Array<{
    election_id: string;
    seats_total: number | null;
  }>;
  let turnoutChecked = 0;
  let resultsChecked = 0;

  for (const e of elections) {
    const t = db
      .prepare(`SELECT * FROM election_turnout WHERE election_id = ? AND district_id IS NULL`)
      .get(e.election_id) as
      | { voters_registered: number; ballots_cast: number; valid_ballots: number | null; percent: number }
      | undefined;
    if (t) {
      turnoutChecked += 1;
      if (t.ballots_cast > t.voters_registered)
        errors.push(`${e.election_id}: ballots_cast > voters_registered`);
      const calcPct = (t.ballots_cast / t.voters_registered) * 100;
      if (Math.abs(calcPct - t.percent) > 0.5)
        errors.push(`${e.election_id}: явка ${t.percent} ≠ расчётная ${calcPct.toFixed(2)}`);
    }
    const results = db
      .prepare(`SELECT votes, percent, seats, is_party_list FROM election_results WHERE election_id = ?`)
      .all(e.election_id) as Array<{ votes: number; percent: number | null; seats: number | null; is_party_list: number }>;
    let pctSum = 0;
    let seatsSum = 0;
    for (const r of results) {
      resultsChecked += 1;
      if (r.percent !== null && t?.valid_ballots) {
        const calcVotes = (t.valid_ballots * r.percent) / 100;
        if (Math.abs(calcVotes - r.votes) / Math.max(calcVotes, 1) > 0.01) {
          errors.push(`${e.election_id}: votes ${r.votes} ≠ ${r.percent}% от valid_ballots (${Math.round(calcVotes)})`);
        }
        pctSum += r.percent;
      }
      if (r.seats !== null) seatsSum += r.seats;
    }
    if (pctSum > 100.5) errors.push(`${e.election_id}: сумма процентов списков ${pctSum.toFixed(2)} > 100`);
    if (e.seats_total !== null && seatsSum > e.seats_total)
      errors.push(`${e.election_id}: сумма мест ${seatsSum} > seats_total ${e.seats_total}`);
  }
  return {
    elections_checked: elections.length,
    results_checked: resultsChecked,
    turnout_checked: turnoutChecked,
    errors
  };
}
