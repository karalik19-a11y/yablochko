import type { Db } from '../db.js';
import {
  computeRegistryTimeline,
  registryStats,
  type PartyPositionView,
  type RegistryStats
} from '@yabloko/domain';
import type {
  ElectionParticipation,
  Party,
  PartyBody,
  PartyCandidate,
  PartyContext,
  PartyDocument,
  PartyEvent,
  PartyLeader,
  PartyPosition
} from '@yabloko/api-contract';

/**
 * Репозиторий партийного контекста. Отдаёт данные в форматах api-contract.
 * Вычисление статусов позиций — через @yabloko/domain (чистые функции).
 */

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function num(v: unknown): number {
  return Number(v);
}

export function getParty(db: Db): Party | null {
  const row = db
    .prepare(
      `SELECT p.*, s.name AS source_name FROM party p
       LEFT JOIN sources s ON s.source_id = p.source_id LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    party_id: str(row.party_id) ?? '',
    short_name: str(row.short_name) ?? '',
    full_name: str(row.full_name) ?? '',
    status_note: str(row.status_note),
    source_id: str(row.source_id) ?? '',
    source_name: str(row.source_name),
    verification_status: (str(row.verification_status) ?? 'UNVERIFIED') as Party['verification_status']
  };
}

export function listLeaders(db: Db): PartyLeader[] {
  const rows = db
    .prepare(
      `SELECT l.*, b.name AS body_name FROM party_leaders l
       LEFT JOIN party_bodies b ON b.body_id = l.body_id
       ORDER BY CASE WHEN l.body_id IS NULL THEN 0 ELSE 1 END, l.leader_id`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    leader_id: str(r.leader_id) ?? '',
    person_name: str(r.person_name) ?? '',
    role_title: str(r.role_title) ?? '',
    body_id: str(r.body_id),
    body_name: str(r.body_name),
    date_from: str(r.date_from),
    date_to: str(r.date_to),
    date_note: str(r.date_note),
    source_id: str(r.source_id) ?? '',
    confidence: (str(r.confidence) ?? 'LOW') as PartyLeader['confidence'],
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyLeader['verification_status']
  }));
}

export function listBodies(db: Db): PartyBody[] {
  const rows = db
    .prepare(`SELECT * FROM party_bodies ORDER BY body_id`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    body_id: str(r.body_id) ?? '',
    name: str(r.name) ?? '',
    body_type: str(r.body_type) ?? '',
    description: str(r.description),
    source_id: str(r.source_id) ?? '',
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyBody['verification_status']
  }));
}

function loadPositionsRaw(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT p.*, s.name AS source_name, d.title AS document_title
       FROM party_positions p
       LEFT JOIN sources s ON s.source_id = p.source_id
       LEFT JOIN party_documents d ON d.doc_id = p.party_document_id`
    )
    .all() as Array<Record<string, unknown>>;
}

function mapPosition(r: Record<string, unknown>, v: PartyPositionView): PartyPosition {
  return {
    position_id: str(r.position_id) ?? '',
    topic: str(r.topic) ?? '',
    exact_position: str(r.exact_position) ?? '',
    date_from: str(r.date_from) ?? '',
    date_from_precision: (str(r.date_from_precision) ?? 'day') as PartyPosition['date_from_precision'],
    date_to: str(r.date_to),
    source_id: str(r.source_id) ?? '',
    source_name: str(r.source_name),
    party_document_id: str(r.party_document_id),
    party_document_title: str(r.document_title),
    confidence: (str(r.confidence) ?? 'LOW') as PartyPosition['confidence'],
    statement_category: (str(r.statement_category) ??
      'OFFICIAL_PARTY_STATEMENT') as PartyPosition['statement_category'],
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyPosition['verification_status'],
    current_status: v.current_status,
    superseded_by: v.superseded_by,
    effective_to: v.effective_to
  };
}

/** Все позиции с вычисленным таймлайн-статусом на дату. */
export function listPositionsComputed(db: Db, asOf: string): PartyPosition[] {
  const raw = loadPositionsRaw(db);
  const records = raw.map((r) => ({
    position_id: str(r.position_id) ?? '',
    topic: str(r.topic) ?? '',
    exact_position: str(r.exact_position) ?? '',
    date_from: str(r.date_from) ?? '',
    date_from_precision: (str(r.date_from_precision) ?? 'day') as never,
    date_to: str(r.date_to),
    source_id: str(r.source_id) ?? '',
    party_document_id: str(r.party_document_id),
    confidence: (str(r.confidence) ?? 'LOW') as never,
    statement_category: (str(r.statement_category) ?? 'OFFICIAL_PARTY_STATEMENT') as never,
    verification_status: (str(r.verification_status) ?? 'UNVERIFIED') as never
  }));
  const timeline = computeRegistryTimeline(records, asOf);
  const byId = new Map(timeline.positions.map((v) => [v.position_id, v]));
  return raw.map((r) => {
    const v = byId.get(str(r.position_id) ?? '');
    return mapPosition(
      r,
      v ?? {
        position_id: str(r.position_id) ?? '',
        topic: str(r.topic) ?? '',
        exact_position: str(r.exact_position) ?? '',
        date_from: str(r.date_from) ?? '',
        date_from_precision: 'day',
        date_to: str(r.date_to),
        source_id: str(r.source_id) ?? '',
        party_document_id: str(r.party_document_id),
        confidence: 'LOW',
        statement_category: 'OFFICIAL_PARTY_STATEMENT',
        verification_status: 'UNVERIFIED',
        current_status: 'UNVERIFIED',
        superseded_by: null,
        effective_to: null
      }
    );
  });
}

export function listDocuments(db: Db): PartyDocument[] {
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS source_name FROM party_documents d
       LEFT JOIN sources s ON s.source_id = d.source_id
       ORDER BY d.doc_date DESC, d.doc_id`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    doc_id: str(r.doc_id) ?? '',
    doc_type: str(r.doc_type) ?? '',
    title: str(r.title) ?? '',
    doc_date: str(r.doc_date),
    date_precision: (str(r.date_precision) ?? 'day') as PartyDocument['date_precision'],
    issuer: str(r.issuer),
    summary: str(r.summary),
    source_id: str(r.source_id) ?? '',
    source_name: str(r.source_name),
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyDocument['verification_status']
  }));
}

export function listEvents(db: Db): PartyEvent[] {
  const rows = db
    .prepare(`SELECT * FROM party_events ORDER BY event_date DESC, event_id`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    event_id: str(r.event_id) ?? '',
    title: str(r.title) ?? '',
    event_type: str(r.event_type) ?? '',
    event_date: str(r.event_date),
    date_precision: (str(r.date_precision) ?? 'day') as PartyEvent['date_precision'],
    description: str(r.description),
    source_id: str(r.source_id) ?? '',
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyEvent['verification_status']
  }));
}

export function countCandidates(db: Db): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM party_candidates').get() as { n: number };
  return num(r.n);
}

export function listCandidates(db: Db): PartyCandidate[] {
  const rows = db
    .prepare(`SELECT * FROM party_candidates ORDER BY candidate_id`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    candidate_id: str(r.candidate_id) ?? '',
    person_name: str(r.person_name) ?? '',
    level: str(r.level) ?? '',
    region_label: str(r.region_label),
    election_id: str(r.election_id),
    registration_status: str(r.registration_status),
    source_id: str(r.source_id) ?? '',
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as PartyCandidate['verification_status']
  }));
}

export function countParticipation(db: Db): number {
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM election_participation')
    .get() as { n: number };
  return num(r.n);
}

export function listParticipation(db: Db): ElectionParticipation[] {
  const rows = db
    .prepare(`SELECT * FROM election_participation ORDER BY election_date DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    participation_id: str(r.participation_id) ?? '',
    election_id: str(r.election_id),
    election_name: str(r.election_name) ?? '',
    election_date: str(r.election_date),
    level: str(r.level) ?? '',
    region_label: str(r.region_label),
    participation_type: str(r.participation_type) ?? '',
    result_summary: str(r.result_summary),
    source_id: str(r.source_id) ?? '',
    verification_status: (str(r.verification_status) ??
      'UNVERIFIED') as ElectionParticipation['verification_status']
  }));
}

export interface PartyContextResult {
  context: PartyContext;
  positionStats: RegistryStats;
}

/** Агрегат YABLOKO TODAY (партийный контекст целиком). */
export function getPartyContext(db: Db, asOf: string): PartyContextResult {
  const party = getParty(db);
  const positions = listPositionsComputed(db, asOf);
  const timeline = computeRegistryTimeline(
    // Обратное преобразование не требуется: stats считаются из views.
    positions.map((p) => ({
      position_id: p.position_id,
      topic: p.topic,
      exact_position: p.exact_position,
      date_from: p.date_from,
      date_from_precision: p.date_from_precision,
      date_to: p.date_to,
      source_id: p.source_id,
      party_document_id: p.party_document_id,
      confidence: p.confidence,
      statement_category: p.statement_category,
      verification_status: p.verification_status
    })),
    asOf
  );
  const stats = registryStats(timeline);

  const context: PartyContext = {
    party:
      party ??
      {
        party_id: '',
        short_name: '',
        full_name: '',
        status_note: 'Партийный контекст не загружен',
        source_id: '',
        source_name: null,
        verification_status: 'UNVERIFIED'
      },
    leaders: listLeaders(db),
    bodies: listBodies(db),
    currentPositions: positions.filter(
      (p) => p.current_status === 'CURRENT' || p.current_status === 'UNVERIFIED'
    ),
    latestDocuments: listDocuments(db),
    events: listEvents(db),
    candidates: {
      count: countCandidates(db),
      note:
        countCandidates(db) === 0
          ? 'INSUFFICIENT DATA: сведения о кандидатах появятся после подключения официальных источников (Этап 8).'
          : ''
    },
    electionParticipation: {
      count: countParticipation(db),
      note:
        countParticipation(db) === 0
          ? 'INSUFFICIENT DATA: история участия в выборах будет импортирована на Этапе 8 с официальными источниками.'
          : ''
    },
    stats: {
      positionsTotal: stats.total,
      positionsCurrent: stats.current,
      positionsUnverified: stats.unverified,
      conflicts: stats.conflicts,
      documentsCount: stats.total >= 0 ? listDocuments(db).length : 0,
      eventsCount: listEvents(db).length,
      leadersCount: listLeaders(db).length,
      bodiesCount: listBodies(db).length
    }
  };

  return { context, positionStats: stats };
}
