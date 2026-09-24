import { randomUUID } from 'node:crypto';
import type { Db } from '@yabloko/data-access';
import type { JobDefinition, JobRunRecord, JobStatus } from './types.js';

/**
 * Минимальный планировщик фоновых задач (каркас автоматического обновления).
 * Запуски записываются в job_runs; интервалы считаются от последнего запуска.
 */

export interface PersistedRun {
  run_id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  detail: string | null;
}

export class JobRunner {
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly lastRunAt = new Map<string, number>();
  private running = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly clock: () => number = () => Date.now()
  ) {}

  register(job: JobDefinition): void {
    this.jobs.set(job.name, job);
  }

  /** Проверяет по журналу, когда задача запускалась последний раз. */
  restoreFromLog(now: number = this.clock()): void {
    for (const job of this.jobs.values()) {
      const row = this.db
        .prepare(
          'SELECT started_at FROM job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 1'
        )
        .get(job.name) as { started_at: string } | undefined;
      if (row) this.lastRunAt.set(job.name, Date.parse(row.started_at) || now);
    }
  }

  isDue(job: JobDefinition, now: number = this.clock()): boolean {
    if (this.running.has(job.name)) return false;
    const last = this.lastRunAt.get(job.name);
    if (last === undefined) return true;
    return now - last >= job.intervalMs;
  }

  async runDue(now: number = this.clock()): Promise<JobRunRecord[]> {
    const results: JobRunRecord[] = [];
    for (const job of this.jobs.values()) {
      if (!this.isDue(job, now)) continue;
      results.push(await this.runOne(job, now));
    }
    return results;
  }

  async runOne(job: JobDefinition, now: number = this.clock()): Promise<JobRunRecord> {
    this.running.add(job.name);
    const startedIso = new Date(now).toISOString();
    const runId = randomUUID();
    let status: JobStatus = 'error';
    let detail: string | null = null;
    try {
      const outcome = await job.execute();
      status = outcome.status;
      detail = outcome.detail ?? null;
    } catch (e) {
      status = 'error';
      detail = e instanceof Error ? e.message : String(e);
    } finally {
      this.running.delete(job.name);
    }
    const finished = this.clock();
    this.lastRunAt.set(job.name, finished);
    const record: JobRunRecord = {
      run_id: runId,
      job_name: job.name,
      status,
      started_at: startedIso,
      finished_at: new Date(finished).toISOString(),
      detail
    };
    this.persist(record);
    return record;
  }

  private persist(r: JobRunRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO job_runs (run_id, job_name, status, started_at, finished_at, detail)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(r.run_id, r.job_name, r.status, r.started_at, r.finished_at, r.detail);
  }
}
