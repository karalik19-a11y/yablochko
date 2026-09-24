import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * OSINT (Этап 10): граф ПУБЛИЧНЫХ сущностей (публичные фигуры, организации,
 * компании, СМИ) с evidence-рёбрами. Приватные лица не вносятся (CHECK
 * kind='person' требует public_role — схема + тесты). Рёбра без evidence
 * невозможны (NOT NULL + CHECK + REFERENCES sources). Никаких профилей
 * частных лиц, сторонников/противников и персональных электоральных данных.
 */

export const OsintGraphFile = z.object({
  meta: z.object({ note: z.string(), methodology: z.string() }).passthrough(),
  entities: z.array(
    z.object({
      entity_id: z.string(),
      kind: z.enum(['person', 'organization', 'company', 'media']),
      name: z.string(),
      public_role: z.string().nullable().default(null),
      description: z.string().nullable().default(null),
      source_id: z.string()
    })
  ),
  events: z
    .array(
      z.object({
        event_id: z.string(),
        title: z.string(),
        event_date: z.string().nullable().default(null),
        date_precision: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
        source_id: z.string()
      })
    )
    .default([]),
  documents: z
    .array(
      z.object({
        document_id: z.string(),
        title: z.string(),
        published_date: z.string().nullable().default(null),
        date_precision: z.string().nullable().default(null),
        party_document_id: z.string().nullable().default(null),
        url: z.string().nullable().default(null),
        source_id: z.string()
      })
    )
    .default([]),
  statements: z
    .array(
      z.object({
        statement_id: z.string(),
        entity_id: z.string(),
        position_id: z.string().nullable().default(null),
        document_id: z.string().nullable().default(null),
        summary: z.string(),
        statement_date: z.string().nullable().default(null),
        statement_category: z.enum(['OFFICIAL_PARTY_STATEMENT', 'PUBLIC_STATEMENT']),
        source_id: z.string()
      })
    )
    .default([]),
  edges: z.array(
    z.object({
      edge_id: z.string(),
      src_entity_id: z.string(),
      relation: z.enum(['works_at', 'member_of', 'spoke_at', 'published', 'mentioned', 'associated_with', 'participated_in']),
      dst_entity_id: z.string().nullable().default(null),
      dst_document_id: z.string().nullable().default(null),
      dst_event_id: z.string().nullable().default(null),
      dst_statement_id: z.string().nullable().default(null),
      evidence: z.string(),
      evidence_source_id: z.string(),
      evidence_url: z.string().nullable().default(null),
      confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM')
    })
  )
});
export type OsintGraphFile = z.infer<typeof OsintGraphFile>;

export function loadOsintGraph(path: string): OsintGraphFile {
  return OsintGraphFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export function seedOsintGraph(db: Db, file: OsintGraphFile): { entities: number; edges: number } {
  const ts = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const upEnt = db.prepare(`
      INSERT INTO osint_entities (entity_id, kind, name, public_role, description, source_id, verification_status, data_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED', 'SEED', ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET kind=excluded.kind, name=excluded.name, public_role=excluded.public_role,
        description=excluded.description, source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    for (const e of file.entities) upEnt.run(e.entity_id, e.kind, e.name, e.public_role, e.description, e.source_id, ts, ts);

    const upEv = db.prepare(`
      INSERT INTO osint_events (event_id, title, event_date, date_precision, description, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET title=excluded.title, event_date=excluded.event_date,
        date_precision=excluded.date_precision, description=excluded.description, source_id=excluded.source_id,
        updated_at=excluded.updated_at
    `);
    for (const e of file.events) upEv.run(e.event_id, e.title, e.event_date, e.date_precision, e.description, e.source_id, ts, ts);

    const upDoc = db.prepare(`
      INSERT INTO osint_documents (document_id, title, published_date, date_precision, party_document_id, url, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET title=excluded.title, published_date=excluded.published_date,
        date_precision=excluded.date_precision, party_document_id=excluded.party_document_id, url=excluded.url,
        source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    for (const d of file.documents)
      upDoc.run(d.document_id, d.title, d.published_date, d.date_precision, d.party_document_id, d.url, d.source_id, ts, ts);

    const upSt = db.prepare(`
      INSERT INTO osint_statements (statement_id, entity_id, position_id, document_id, summary, statement_date,
        statement_category, source_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(statement_id) DO UPDATE SET entity_id=excluded.entity_id, position_id=excluded.position_id,
        document_id=excluded.document_id, summary=excluded.summary, statement_date=excluded.statement_date,
        statement_category=excluded.statement_category, source_id=excluded.source_id, updated_at=excluded.updated_at
    `);
    for (const s of file.statements)
      upSt.run(s.statement_id, s.entity_id, s.position_id, s.document_id, s.summary, s.statement_date, s.statement_category, s.source_id, ts, ts);

    const upEdge = db.prepare(`
      INSERT INTO osint_edges (edge_id, src_entity_id, relation, dst_entity_id, dst_document_id, dst_event_id,
        dst_statement_id, evidence, evidence_source_id, evidence_url, confidence, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET relation=excluded.relation, dst_entity_id=excluded.dst_entity_id,
        dst_document_id=excluded.dst_document_id, dst_event_id=excluded.dst_event_id,
        dst_statement_id=excluded.dst_statement_id, evidence=excluded.evidence,
        evidence_source_id=excluded.evidence_source_id, evidence_url=excluded.evidence_url,
        confidence=excluded.confidence, updated_at=excluded.updated_at
    `);
    for (const e of file.edges)
      upEdge.run(e.edge_id, e.src_entity_id, e.relation, e.dst_entity_id, e.dst_document_id, e.dst_event_id,
        e.dst_statement_id, e.evidence, e.evidence_source_id, e.evidence_url, e.confidence, ts, ts);

    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'osint_graph_seed', 'osint_entities', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ entities: file.entities.length, edges: file.edges.length }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { entities: file.entities.length, edges: file.edges.length };
}

// ---------- Чтение: граф, профиль, поиск ----------

export interface OsintEntity {
  entity_id: string;
  kind: string;
  name: string;
  public_role: string | null;
  description: string | null;
  source_id: string;
  verification_status: string;
  data_mode: string;
}

export interface OsintGraph {
  entities: OsintEntity[];
  edges: Array<{
    edge_id: string;
    src_entity_id: string;
    relation: string;
    dst_entity_id: string | null;
    dst_document_id: string | null;
    dst_event_id: string | null;
    dst_statement_id: string | null;
    evidence: string;
    evidence_source_id: string;
    evidence_source_name: string | null;
    confidence: string;
    verification_status: string;
  }>;
  documents: Array<{ document_id: string; title: string; published_date: string | null; party_document_id: string | null }>;
  events: Array<{ event_id: string; title: string; event_date: string | null; description: string | null }>;
  methodology: string;
  /** Сводка: приватные лица отсутствуют архитектурно. */
  privacy_note: string;
}

export function getOsintGraph(db: Db, methodology: string): OsintGraph {
  const entities = (
    db.prepare(`SELECT * FROM osint_entities ORDER BY kind, name`).all() as Array<Record<string, unknown>>
  ).map((r) => ({
    entity_id: String(r.entity_id),
    kind: String(r.kind),
    name: String(r.name),
    public_role: (r.public_role as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    source_id: String(r.source_id),
    verification_status: String(r.verification_status),
    data_mode: String(r.data_mode)
  }));
  const edges = (
    db.prepare(`SELECT * FROM osint_edges ORDER BY edge_id`).all() as Array<Record<string, unknown>>
  ).map((r) => ({
    edge_id: String(r.edge_id),
    src_entity_id: String(r.src_entity_id),
    relation: String(r.relation),
    dst_entity_id: (r.dst_entity_id as string | null) ?? null,
    dst_document_id: (r.dst_document_id as string | null) ?? null,
    dst_event_id: (r.dst_event_id as string | null) ?? null,
    dst_statement_id: (r.dst_statement_id as string | null) ?? null,
    evidence: String(r.evidence),
    evidence_source_id: String(r.evidence_source_id),
    evidence_source_name: sourceNameOf(db, String(r.evidence_source_id)),
    confidence: String(r.confidence),
    verification_status: String(r.verification_status)
  }));
  const documents = (
    db.prepare(`SELECT document_id, title, published_date, party_document_id FROM osint_documents`).all() as Array<
      Record<string, unknown>
    >
  ).map((r) => ({
    document_id: String(r.document_id),
    title: String(r.title),
    published_date: (r.published_date as string | null) ?? null,
    party_document_id: (r.party_document_id as string | null) ?? null
  }));
  const events = (
    db.prepare(`SELECT event_id, title, event_date, description FROM osint_events`).all() as Array<
      Record<string, unknown>
    >
  ).map((r) => ({
    event_id: String(r.event_id),
    title: String(r.title),
    event_date: (r.event_date as string | null) ?? null,
    description: (r.description as string | null) ?? null
  }));
  return {
    entities,
    edges,
    documents,
    events,
    methodology,
    privacy_note:
      'Только публичные сущности с явной публичной ролью. Приватные лица, профили сторонников/противников и персональные электоральные оценки отсутствуют в схеме (CHECK) и не вносятся.'
  };
}

function sourceNameOf(db: Db, sourceId: string): string | null {
  const r = db.prepare(`SELECT name FROM sources WHERE source_id = ?`).get(sourceId) as { name: string } | undefined;
  return r?.name ?? sourceId;
}

export interface OsintProfile {
  identity: {
    entity_id: string;
    kind: string;
    name: string;
    public_role: string | null;
    description: string | null;
    verification_status: string;
    source_id: string;
    source_name: string | null;
  };
  affiliations: Array<{
    relation: string;
    direction: 'out' | 'in';
    other_entity_id: string | null;
    other_name: string | null;
    evidence: string;
    evidence_source_id: string;
    evidence_source_name: string | null;
    confidence: string;
  }>;
  statements: Array<{
    statement_id: string;
    summary: string;
    statement_category: string;
    statement_date: string | null;
    position_id: string | null;
    source_id: string;
  }>;
  timeline: Array<{
    date: string | null;
    kind: string;
    title: string;
    evidence: string;
    source_id: string;
  }>;
  sources: Array<{ source_id: string; source_name: string | null; uses: number }>;
  privacy_note: string;
}

/** Профиль публичной фигуры по разделам IDENTITY → AFFILIATIONS → STATEMENTS → TIMELINE → SOURCES. */
export function getOsintProfile(db: Db, entityId: string, privacyNote: string): OsintProfile | null {
  const e = db.prepare(`SELECT * FROM osint_entities WHERE entity_id = ?`).get(entityId) as
    | Record<string, unknown>
    | undefined;
  if (!e) return null;
  const id = String(e.entity_id);

  const edgeRows = db
    .prepare(`SELECT * FROM osint_edges WHERE src_entity_id = ? OR dst_entity_id = ?`)
    .all(id, id) as Array<Record<string, unknown>>;

  const affiliations = edgeRows.map((r) => {
    const dir: 'out' | 'in' = String(r.src_entity_id) === id ? 'out' : 'in';
    const otherId = dir === 'out' ? ((r.dst_entity_id as string | null) ?? null) : String(r.src_entity_id);
    const other = otherId
      ? (db.prepare(`SELECT name FROM osint_entities WHERE entity_id = ?`).get(otherId) as { name: string } | undefined)
      : undefined;
    return {
      relation: String(r.relation),
      direction: dir,
      other_entity_id: otherId,
      other_name: other?.name ?? otherId ?? (r.dst_document_id as string | null) ?? (r.dst_event_id as string | null) ?? (r.dst_statement_id as string | null),
      evidence: String(r.evidence),
      evidence_source_id: String(r.evidence_source_id),
      evidence_source_name: sourceNameOf(db, String(r.evidence_source_id)),
      confidence: String(r.confidence)
    };
  });

  const statements = (
    db.prepare(`SELECT * FROM osint_statements WHERE entity_id = ? ORDER BY statement_date`).all(id) as Array<
      Record<string, unknown>
    >
  ).map((r) => ({
    statement_id: String(r.statement_id),
    summary: String(r.summary),
    statement_category: String(r.statement_category),
    statement_date: (r.statement_date as string | null) ?? null,
    position_id: (r.position_id as string | null) ?? null,
    source_id: String(r.source_id)
  }));

  // Timeline: события/документы, связанные рёбрами + даты заявлений.
  const timeline: OsintProfile['timeline'] = [];
  for (const r of edgeRows) {
    const evidence = String(r.evidence);
    if (r.dst_event_id) {
      const ev = db.prepare(`SELECT title, event_date FROM osint_events WHERE event_id = ?`).get(String(r.dst_event_id)) as
        | { title: string; event_date: string | null }
        | undefined;
      if (ev) timeline.push({ date: ev.event_date, kind: 'event', title: ev.title, evidence, source_id: String(r.evidence_source_id) });
    }
    if (r.dst_document_id) {
      const doc = db
        .prepare(`SELECT title, published_date FROM osint_documents WHERE document_id = ?`)
        .get(String(r.dst_document_id)) as { title: string; published_date: string | null } | undefined;
      if (doc) timeline.push({ date: doc.published_date, kind: 'document', title: doc.title, evidence, source_id: String(r.evidence_source_id) });
    }
    if (r.dst_statement_id) {
      const st = db
        .prepare(`SELECT summary, statement_date FROM osint_statements WHERE statement_id = ?`)
        .get(String(r.dst_statement_id)) as { summary: string; statement_date: string | null } | undefined;
      if (st) timeline.push({ date: st.statement_date, kind: 'statement', title: st.summary, evidence, source_id: String(r.evidence_source_id) });
    }
  }
  for (const s of statements) {
    if (!timeline.some((t) => t.kind === 'statement' && t.title === s.summary)) {
      timeline.push({ date: s.statement_date, kind: 'statement', title: s.summary, evidence: `source: ${s.source_id}`, source_id: s.source_id });
    }
  }
  timeline.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const srcCounts = new Map<string, number>();
  for (const a of affiliations) srcCounts.set(a.evidence_source_id, (srcCounts.get(a.evidence_source_id) ?? 0) + 1);
  srcCounts.set(String(e.source_id), (srcCounts.get(String(e.source_id)) ?? 0) + 1);
  for (const s of statements) srcCounts.set(s.source_id, (srcCounts.get(s.source_id) ?? 0) + 1);

  return {
    identity: {
      entity_id: id,
      kind: String(e.kind),
      name: String(e.name),
      public_role: (e.public_role as string | null) ?? null,
      description: (e.description as string | null) ?? null,
      verification_status: String(e.verification_status),
      source_id: String(e.source_id),
      source_name: sourceNameOf(db, String(e.source_id))
    },
    affiliations,
    statements,
    timeline,
    sources: [...srcCounts.entries()]
      .map(([source_id, uses]) => ({ source_id, source_name: sourceNameOf(db, source_id), uses }))
      .sort((a, b) => b.uses - a.uses),
    privacy_note: privacyNote
  };
}

export function searchOsintEntities(db: Db, q: string): OsintEntity[] {
  // Фильтр в JS: lower() в SQLite не обрабатывает кириллицу.
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const all = db.prepare(`SELECT * FROM osint_entities ORDER BY name`).all() as Array<Record<string, unknown>>;
  const rows = all
    .filter((r) =>
      `${String(r.name)} ${String(r.public_role ?? '')} ${String(r.description ?? '')}`.toLowerCase().includes(query)
    )
    .slice(0, 20);
  return rows.map((r) => ({
    entity_id: String(r.entity_id),
    kind: String(r.kind),
    name: String(r.name),
    public_role: (r.public_role as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    source_id: String(r.source_id),
    verification_status: String(r.verification_status),
    data_mode: String(r.data_mode)
  }));
}
