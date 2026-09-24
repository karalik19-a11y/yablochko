import { describe, expect, it, vi } from 'vitest';
import { openDb } from '@yabloko/data-access';
import { migrate } from '@yabloko/data-access';
import { JobRunner } from './scheduler.js';
import { checkSourceAccess } from './access.js';
import { createPartyContextRefreshJob } from './jobs/partyContextRefresh.js';

function mkDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('JobRunner', () => {
  it('запускает незапускавшуюся задачу и записывает результат', async () => {
    const db = mkDb();
    const runner = new JobRunner(db, () => 1_000);
    const exec = vi.fn().mockResolvedValue({ status: 'ok', detail: 'done' });
    runner.register({ name: 'j1', intervalMs: 1000, execute: exec });

    const runs = await runner.runDue(1_000);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('ok');
    const rows = db
      .prepare('SELECT job_name, status FROM job_runs')
      .all() as Array<{ job_name: string; status: string }>;
    expect(rows[0]?.job_name).toBe('j1');
  });

  it('не запускает задачу раньше интервала', async () => {
    const db = mkDb();
    let now = 1_000;
    const runner = new JobRunner(db, () => now);
    const exec = vi.fn().mockResolvedValue({ status: 'ok' });
    runner.register({ name: 'j1', intervalMs: 10_000, execute: exec });

    await runner.runDue(now); // первый запуск
    now += 5_000;
    await runner.runDue(now); // рано
    expect(exec).toHaveBeenCalledTimes(1);
    now += 6_000; // суммарно > 10с от первого
    await runner.runDue(now);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('restoreFromLog учитывает прошлые запуски после перезапуска', async () => {
    const db = mkDb();
    let now = 10_000;
    const first = new JobRunner(db, () => now);
    const exec = vi.fn().mockResolvedValue({ status: 'ok' });
    first.register({ name: 'j1', intervalMs: 10_000, execute: exec });
    await first.runDue(now);

    // «Перезапуск процесса»: новый runner с тем же журналом.
    now += 5_000;
    const second = new JobRunner(db, () => now);
    second.register({ name: 'j1', intervalMs: 10_000, execute: exec });
    second.restoreFromLog(now);
    expect(second.isDue({ name: 'j1', intervalMs: 10_000, execute: exec }, now)).toBe(false);

    now += 6_000;
    second.restoreFromLog(now);
    expect(second.isDue({ name: 'j1', intervalMs: 10_000, execute: exec }, now)).toBe(true);
  });

  it('исключение в задаче → статус error, журнал записан', async () => {
    const db = mkDb();
    const runner = new JobRunner(db, () => 1);
    runner.register({
      name: 'boom',
      intervalMs: 1000,
      execute: async () => {
        throw new Error('упс');
      }
    });
    const runs = await runner.runDue(1);
    expect(runs[0]?.status).toBe('error');
    expect(runs[0]?.detail).toContain('упс');
  });
});

describe('checkSourceAccess', () => {
  const okFetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
  const errFetch = (async () =>
    new Response('nope', { status: 503 })) as unknown as typeof fetch;
  const netFail = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const hangFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      );
    })) as unknown as typeof fetch;

  it('ok при 2xx', async () => {
    const r = await checkSourceAccess('https://example.test', { fetchImpl: okFetch });
    expect(r.outcome).toBe('ok');
    expect(r.httpStatus).toBe(200);
  });

  it('http_error при ошибочном статусе', async () => {
    const r = await checkSourceAccess('https://example.test', { fetchImpl: errFetch });
    expect(r.outcome).toBe('http_error');
    expect(r.httpStatus).toBe(503);
  });

  it('network_unavailable при сетевом сбое (не бросает исключений)', async () => {
    const r = await checkSourceAccess('https://example.test', { fetchImpl: netFail });
    expect(r.outcome).toBe('network_unavailable');
  });

  it('timeout при зависшем соединении', async () => {
    const r = await checkSourceAccess('https://example.test', {
      fetchImpl: hangFetch,
      timeoutMs: 20
    });
    expect(r.outcome).toBe('timeout');
  });
});

describe('party-context-refresh job', () => {
  it('в среде без сети честно фиксирует network_unavailable', async () => {
    const db = mkDb();
    const job = createPartyContextRefreshJob(db, {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch
    });
    const outcome = await job.execute();
    expect(outcome.status).toBe('network_unavailable');
    expect(outcome.detail).toContain('Сеть недоступна');
  });

  it('при доступном источнике — ok', async () => {
    const db = mkDb();
    const job = createPartyContextRefreshJob(db, {
      fetchImpl: (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    });
    const outcome = await job.execute();
    expect(outcome.status).toBe('ok');
  });
});
