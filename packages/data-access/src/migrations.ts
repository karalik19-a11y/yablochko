import type { Db } from './db.js';

/**
 * Миграции схемы (транзакционное ядро, логическая схема едина для
 * embedded- и server-профилей — docs/ARCHITECTURE.md §5).
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: '001_core_party_context',
    sql: `
CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE party (
  party_id TEXT PRIMARY KEY,
  short_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status_note TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT,
  url TEXT,
  source_type TEXT NOT NULL,
  license TEXT,
  collection_method TEXT,
  coverage TEXT,
  period TEXT,
  update_frequency TEXT,
  reliability_metadata TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  update_policy TEXT,
  last_update TEXT,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  url TEXT,
  fetched_at TEXT,
  content_hash TEXT,
  mime TEXT,
  raw_object_ref TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL
);

CREATE TABLE party_documents (
  doc_id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  doc_date TEXT,
  date_precision TEXT NOT NULL DEFAULT 'day',
  issuer TEXT,
  summary TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_party_documents_date ON party_documents(doc_date DESC);

CREATE TABLE party_positions (
  position_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  exact_position TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_from_precision TEXT NOT NULL DEFAULT 'day',
  date_to TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  party_document_id TEXT REFERENCES party_documents(doc_id),
  confidence TEXT NOT NULL DEFAULT 'LOW',
  statement_category TEXT NOT NULL DEFAULT 'OFFICIAL_PARTY_STATEMENT',
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_positions_topic ON party_positions(topic, date_from);

CREATE TABLE party_bodies (
  body_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body_type TEXT NOT NULL,
  description TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE party_leaders (
  leader_id TEXT PRIMARY KEY,
  person_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  body_id TEXT REFERENCES party_bodies(body_id),
  date_from TEXT,
  date_to TEXT,
  date_note TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  confidence TEXT NOT NULL DEFAULT 'LOW',
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE party_events (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT,
  date_precision TEXT NOT NULL DEFAULT 'day',
  description TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_party_events_date ON party_events(event_date DESC);

CREATE TABLE party_candidates (
  candidate_id TEXT PRIMARY KEY,
  person_name TEXT NOT NULL,
  level TEXT NOT NULL,
  region_label TEXT,
  election_id TEXT,
  registration_status TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE election_participation (
  participation_id TEXT PRIMARY KEY,
  election_id TEXT,
  election_name TEXT NOT NULL,
  election_date TEXT,
  level TEXT NOT NULL,
  region_label TEXT,
  participation_type TEXT NOT NULL,
  result_summary TEXT,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  at TEXT NOT NULL,
  details TEXT
);

CREATE TABLE job_runs (
  run_id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  detail TEXT
);
CREATE INDEX idx_job_runs_name ON job_runs(job_name, started_at DESC);
`
  }
];

export interface MigrateResult {
  appliedIds: number[];
  totalMigrations: number;
}

export function migrate(db: Db): MigrateResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db.prepare('SELECT id FROM _migrations').all() as Array<{
    id: number;
  }>;
  const applied = new Set(appliedRows.map((r) => Number(r.id)));
  const appliedIds: number[] = [];

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
      appliedIds.push(m.id);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Миграция ${m.id} (${m.name}) не применилась: ${String(e)}`);
    }
  }

  return { appliedIds, totalMigrations: MIGRATIONS.length };
}

export function countAppliedMigrations(db: Db): number {
  const rows = db
    .prepare('SELECT COUNT(*) AS n FROM _migrations')
    .get() as { n: number };
  return Number(rows.n);
}
