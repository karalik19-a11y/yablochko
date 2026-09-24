import type { Db } from '../db.js';
import { countAppliedMigrations } from '../migrations.js';
import { sourceCounts } from './sources.js';
import type { MetaStatus } from '@yabloko/api-contract';

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export function getLastSeedAt(db: Db): string | null {
  const r = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'last_seed_at'`)
    .get() as { value: string } | undefined;
  return r ? str(r.value) : null;
}

export function getLastJobRun(
  db: Db,
  jobName: string
): MetaStatus['jobs']['lastPartyContextRefresh'] {
  const r = db
    .prepare(
      `SELECT status, started_at, finished_at, detail FROM job_runs
       WHERE job_name = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(jobName) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    status: str(r.status) ?? 'unknown',
    startedAt: str(r.started_at) ?? '',
    finishedAt: str(r.finished_at),
    detail: str(r.detail)
  };
}

export function getMetaStatus(
  db: Db,
  dbPath: string,
  version: string,
  stage: number,
  stageName: string,
  dataMode: MetaStatus['dataMode'],
  dataModeNote: string
): MetaStatus {
  const sc = sourceCounts(db);
  return {
    app: 'YABLOKO INTELLIGENCE',
    version,
    stage,
    stageName,
    dataMode,
    dataModeNote,
    database: {
      engine: 'sqlite',
      path: dbPath,
      migrationsApplied: countAppliedMigrations(db),
      lastSeedAt: getLastSeedAt(db)
    },
    sources: {
      total: sc.total,
      active: sc.active,
      planned: sc.planned,
      failed: sc.failed
    },
    jobs: {
      lastPartyContextRefresh: getLastJobRun(db, 'party-context-refresh')
    }
  };
}
