import { z } from 'zod';
import type { Db } from './db.js';

/**
 * Seed-данные (datasets/party/*). Все записи из INITIAL CONTEXT имеют
 * verification_status = UNVERIFIED и явный source_id — см. ADR-0005 и
 * docs/PROJECT_AUDIT.md §5.
 */

export const SeedSource = z.object({
  source_id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  source_type: z.string().min(1),
  license: z.string().nullable().default(null),
  collection_method: z.string().nullable().default(null),
  coverage: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  update_frequency: z.string().nullable().default(null),
  reliability: z.object({ grade: z.string(), note: z.string() }),
  status: z.enum(['planned', 'active', 'failed', 'retired']).default('planned'),
  update_policy: z.string().nullable().default(null)
});

export const SeedBody = z.object({
  body_id: z.string().min(1),
  name: z.string().min(1),
  body_type: z.string().min(1),
  description: z.string().nullable().default(null),
  source_id: z.string().min(1),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedLeader = z.object({
  leader_id: z.string().min(1),
  person_name: z.string().min(1),
  role_title: z.string().min(1),
  body_id: z.string().nullable().default(null),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  date_note: z.string().nullable().default(null),
  source_id: z.string().min(1),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('LOW'),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedDocument = z.object({
  doc_id: z.string().min(1),
  doc_type: z.string().min(1),
  title: z.string().min(1),
  doc_date: z.string().nullable().default(null),
  date_precision: z.enum(['day', 'month', 'year', 'unknown']).default('day'),
  issuer: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  source_id: z.string().min(1),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedPosition = z.object({
  position_id: z.string().min(1),
  topic: z.string().min(1),
  exact_position: z.string().min(1),
  date_from: z.string().min(1),
  date_from_precision: z.enum(['day', 'month', 'year', 'unknown']).default('day'),
  date_to: z.string().nullable().default(null),
  source_id: z.string().min(1),
  party_document_id: z.string().nullable().default(null),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('LOW'),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedEvent = z.object({
  event_id: z.string().min(1),
  title: z.string().min(1),
  event_type: z.string().min(1),
  event_date: z.string().nullable().default(null),
  date_precision: z.enum(['day', 'month', 'year', 'unknown']).default('day'),
  description: z.string().nullable().default(null),
  source_id: z.string().min(1),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedCandidate = z.object({
  candidate_id: z.string().min(1),
  person_name: z.string().min(1),
  level: z.string().min(1),
  region_label: z.string().nullable().default(null),
  election_id: z.string().nullable().default(null),
  registration_status: z.string().nullable().default(null),
  source_id: z.string().min(1),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedParticipation = z.object({
  participation_id: z.string().min(1),
  election_id: z.string().nullable().default(null),
  election_name: z.string().min(1),
  election_date: z.string().nullable().default(null),
  level: z.string().min(1),
  region_label: z.string().nullable().default(null),
  participation_type: z.string().min(1),
  result_summary: z.string().nullable().default(null),
  source_id: z.string().min(1),
  verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
});

export const SeedBundle = z.object({
  sources: z.array(SeedSource).default([]),
  party: z
    .object({
      party_id: z.string().min(1),
      short_name: z.string().min(1),
      full_name: z.string().min(1),
      status_note: z.string().nullable().default(null),
      source_id: z.string().min(1),
      verification_status: z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']).default('UNVERIFIED')
    })
    .nullable()
    .default(null),
  bodies: z.array(SeedBody).default([]),
  leaders: z.array(SeedLeader).default([]),
  documents: z.array(SeedDocument).default([]),
  positions: z.array(SeedPosition).default([]),
  events: z.array(SeedEvent).default([]),
  candidates: z.array(SeedCandidate).default([]),
  participation: z.array(SeedParticipation).default([])
});

export type SeedBundle = z.infer<typeof SeedBundle>;

export interface SeedReport {
  sources: number;
  party: number;
  bodies: number;
  leaders: number;
  documents: number;
  positions: number;
  events: number;
  candidates: number;
  participation: number;
  unverifiedTotal: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Загружает seed-набор идемпотентно (upsert по первичным ключам).
 * Записи никогда не удаляются — seed только добавляет/обновляет.
 */
export function seedFromBundle(db: Db, bundle: SeedBundle): SeedReport {
  const ts = nowIso();
  const report: SeedReport = {
    sources: 0,
    party: 0,
    bodies: 0,
    leaders: 0,
    documents: 0,
    positions: 0,
    events: 0,
    candidates: 0,
    participation: 0,
    unverifiedTotal: 0
  };

  db.exec('BEGIN');
  try {
    const insSource = db.prepare(`
      INSERT INTO sources (source_id, name, owner, url, source_type, license,
        collection_method, coverage, period, update_frequency,
        reliability_metadata, status, update_policy, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        name=excluded.name, owner=excluded.owner, url=excluded.url,
        source_type=excluded.source_type, license=excluded.license,
        collection_method=excluded.collection_method, coverage=excluded.coverage,
        period=excluded.period, update_frequency=excluded.update_frequency,
        reliability_metadata=excluded.reliability_metadata, status=excluded.status,
        update_policy=excluded.update_policy, updated_at=excluded.updated_at
    `);
    for (const s of bundle.sources) {
      insSource.run(
        s.source_id,
        s.name,
        s.owner,
        s.url,
        s.source_type,
        s.license,
        s.collection_method,
        s.coverage,
        s.period,
        s.update_frequency,
        JSON.stringify(s.reliability),
        s.status,
        s.update_policy,
        ts,
        ts
      );
      report.sources += 1;
    }

    if (bundle.party) {
      const p = bundle.party;
      db.prepare(`
        INSERT INTO party (party_id, short_name, full_name, status_note, source_id,
          verification_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(party_id) DO UPDATE SET
          short_name=excluded.short_name, full_name=excluded.full_name,
          status_note=excluded.status_note, source_id=excluded.source_id,
          verification_status=excluded.verification_status, updated_at=excluded.updated_at
      `).run(
        p.party_id,
        p.short_name,
        p.full_name,
        p.status_note,
        p.source_id,
        p.verification_status,
        ts,
        ts
      );
      report.party = 1;
    }

    const insBody = db.prepare(`
      INSERT INTO party_bodies (body_id, name, body_type, description, source_id,
        verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(body_id) DO UPDATE SET
        name=excluded.name, body_type=excluded.body_type, description=excluded.description,
        source_id=excluded.source_id, verification_status=excluded.verification_status,
        updated_at=excluded.updated_at
    `);
    for (const b of bundle.bodies) {
      insBody.run(
        b.body_id,
        b.name,
        b.body_type,
        b.description,
        b.source_id,
        b.verification_status,
        ts,
        ts
      );
      report.bodies += 1;
    }

    const insLeader = db.prepare(`
      INSERT INTO party_leaders (leader_id, person_name, role_title, body_id, date_from,
        date_to, date_note, source_id, confidence, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(leader_id) DO UPDATE SET
        person_name=excluded.person_name, role_title=excluded.role_title,
        body_id=excluded.body_id, date_from=excluded.date_from, date_to=excluded.date_to,
        date_note=excluded.date_note, source_id=excluded.source_id,
        confidence=excluded.confidence, verification_status=excluded.verification_status,
        updated_at=excluded.updated_at
    `);
    for (const l of bundle.leaders) {
      insLeader.run(
        l.leader_id,
        l.person_name,
        l.role_title,
        l.body_id,
        l.date_from,
        l.date_to,
        l.date_note,
        l.source_id,
        l.confidence,
        l.verification_status,
        ts,
        ts
      );
      report.leaders += 1;
    }

    const insDoc = db.prepare(`
      INSERT INTO party_documents (doc_id, doc_type, title, doc_date, date_precision,
        issuer, summary, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        doc_type=excluded.doc_type, title=excluded.title, doc_date=excluded.doc_date,
        date_precision=excluded.date_precision, issuer=excluded.issuer,
        summary=excluded.summary, source_id=excluded.source_id,
        verification_status=excluded.verification_status, updated_at=excluded.updated_at
    `);
    for (const d of bundle.documents) {
      insDoc.run(
        d.doc_id,
        d.doc_type,
        d.title,
        d.doc_date,
        d.date_precision,
        d.issuer,
        d.summary,
        d.source_id,
        d.verification_status,
        ts,
        ts
      );
      report.documents += 1;
    }

    const insPos = db.prepare(`
      INSERT INTO party_positions (position_id, topic, exact_position, date_from,
        date_from_precision, date_to, source_id, party_document_id, confidence,
        verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(position_id) DO UPDATE SET
        topic=excluded.topic, exact_position=excluded.exact_position,
        date_from=excluded.date_from, date_from_precision=excluded.date_from_precision,
        date_to=excluded.date_to, source_id=excluded.source_id,
        party_document_id=excluded.party_document_id, confidence=excluded.confidence,
        verification_status=excluded.verification_status, updated_at=excluded.updated_at
    `);
    for (const p of bundle.positions) {
      insPos.run(
        p.position_id,
        p.topic,
        p.exact_position,
        p.date_from,
        p.date_from_precision,
        p.date_to,
        p.source_id,
        p.party_document_id,
        p.confidence,
        p.verification_status,
        ts,
        ts
      );
      report.positions += 1;
    }

    const insEvent = db.prepare(`
      INSERT INTO party_events (event_id, title, event_type, event_date, date_precision,
        description, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        title=excluded.title, event_type=excluded.event_type, event_date=excluded.event_date,
        date_precision=excluded.date_precision, description=excluded.description,
        source_id=excluded.source_id, verification_status=excluded.verification_status,
        updated_at=excluded.updated_at
    `);
    for (const e of bundle.events) {
      insEvent.run(
        e.event_id,
        e.title,
        e.event_type,
        e.event_date,
        e.date_precision,
        e.description,
        e.source_id,
        e.verification_status,
        ts,
        ts
      );
      report.events += 1;
    }

    const insCand = db.prepare(`
      INSERT INTO party_candidates (candidate_id, person_name, level, region_label,
        election_id, registration_status, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        person_name=excluded.person_name, level=excluded.level,
        region_label=excluded.region_label, election_id=excluded.election_id,
        registration_status=excluded.registration_status, source_id=excluded.source_id,
        verification_status=excluded.verification_status, updated_at=excluded.updated_at
    `);
    for (const c of bundle.candidates) {
      insCand.run(
        c.candidate_id,
        c.person_name,
        c.level,
        c.region_label,
        c.election_id,
        c.registration_status,
        c.source_id,
        c.verification_status,
        ts,
        ts
      );
      report.candidates += 1;
    }

    const insPart = db.prepare(`
      INSERT INTO election_participation (participation_id, election_id, election_name,
        election_date, level, region_label, participation_type, result_summary,
        source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(participation_id) DO UPDATE SET
        election_id=excluded.election_id, election_name=excluded.election_name,
        election_date=excluded.election_date, level=excluded.level,
        region_label=excluded.region_label, participation_type=excluded.participation_type,
        result_summary=excluded.result_summary, source_id=excluded.source_id,
        verification_status=excluded.verification_status, updated_at=excluded.updated_at
    `);
    for (const p of bundle.participation) {
      insPart.run(
        p.participation_id,
        p.election_id,
        p.election_name,
        p.election_date,
        p.level,
        p.region_label,
        p.participation_type,
        p.result_summary,
        p.source_id,
        p.verification_status,
        ts,
        ts
      );
      report.participation += 1;
    }

    const unverified =
      bundle.sources.filter((s) => s.status === 'planned').length +
      bundle.bodies.filter((b) => b.verification_status !== 'VERIFIED').length +
      bundle.leaders.filter((l) => l.verification_status !== 'VERIFIED').length +
      bundle.documents.filter((d) => d.verification_status !== 'VERIFIED').length +
      bundle.positions.filter((p) => p.verification_status !== 'VERIFIED').length +
      bundle.events.filter((e) => e.verification_status !== 'VERIFIED').length;
    report.unverifiedTotal = unverified;

    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('seed', 'seed_apply', 'database', null, ts, JSON.stringify(report));

    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('last_seed_at', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(ts);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return report;
}
