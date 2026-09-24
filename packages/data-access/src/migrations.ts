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
  },
  {
    id: 2,
    name: '002_ingestion_and_alerts',
    sql: `
-- Снимки HTTP-ответов (неизменяемые, content-addressable)
CREATE TABLE source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL,
  body TEXT,
  fetch_mode TEXT NOT NULL DEFAULT 'live',
  fetch_duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_snapshots_source ON source_snapshots(source_id, fetched_at DESC);

-- Документы источников: парсинг + классификация + версионирование.
-- Дедупликация: уникальность (source_id, content_hash); новое содержимое
-- того же URL — новая строка (версия), история не удаляется.
ALTER TABLE documents ADD COLUMN snapshot_id TEXT REFERENCES source_snapshots(snapshot_id);
ALTER TABLE documents ADD COLUMN title TEXT;
ALTER TABLE documents ADD COLUMN doc_kind TEXT;
ALTER TABLE documents ADD COLUMN published_at TEXT;
ALTER TABLE documents ADD COLUMN date_precision TEXT;
ALTER TABLE documents ADD COLUMN extracted_json TEXT;
ALTER TABLE documents ADD COLUMN text_excerpt TEXT;
ALTER TABLE documents ADD COLUMN last_seen_at TEXT;
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX idx_documents_source_hash ON documents(source_id, content_hash);
CREATE INDEX idx_documents_source_seen ON documents(source_id, last_seen_at DESC);

-- Журнал запусков ingestion
CREATE TABLE ingestion_runs (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  connector TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  stats_json TEXT,
  detail TEXT
);
CREATE INDEX idx_runs_source ON ingestion_runs(source_id, started_at DESC);

-- Пошаговые события pipeline (DISCOVER/FETCH/VERIFY/...)
CREATE TABLE ingestion_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES ingestion_runs(run_id),
  at TEXT NOT NULL,
  stage TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX idx_events_run ON ingestion_events(run_id, id);

-- Alert Center
CREATE TABLE alerts (
  alert_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE INDEX idx_alerts_open ON alerts(acknowledged_at, created_at DESC);

-- FTS-индекс документов (INDEX stage pipeline)
CREATE VIRTUAL TABLE documents_fts USING fts5(
  doc_id UNINDEXED,
  title,
  text_excerpt,
  tokenize = 'unicode61 remove_diacritics 2'
);
`
  },
  {
    id: 3,
    name: '003_geography',
    sql: `
CREATE TABLE geography (
  geo_id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('country','federal_district','subject','municipality','city','district')),
  parent_id TEXT REFERENCES geography(geo_id),
  name TEXT NOT NULL,
  short_name TEXT,
  official_code TEXT,
  code_system TEXT,
  grid_col INTEGER,
  grid_row INTEGER,
  meta_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_geo_parent ON geography(parent_id);
CREATE INDEX idx_geo_level ON geography(level, sort_order);

-- Слияния/переименования территорий: старый ID указывает на новый,
-- история сохраняется (ADR-0008)
CREATE TABLE geo_merges (
  merge_id TEXT PRIMARY KEY,
  from_geo_id TEXT NOT NULL,
  to_geo_id TEXT NOT NULL REFERENCES geography(geo_id),
  date TEXT,
  note TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL
);
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
