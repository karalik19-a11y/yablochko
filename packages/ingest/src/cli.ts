#!/usr/bin/env node
import { resolve } from 'node:path';
import { openDb, migrate, loadSeedDir, seedFromBundle } from '@yabloko/data-access';
import { runPipeline } from './pipeline.js';
import { getConnector, registeredConnectors } from './connectors/index.js';
import { createFixtureFetch } from './fixtures.js';
import { fetchPage } from './http.js';

/**
 * CLI ingestion-раннера.
 *
 * Примеры:
 *   npm run ingest -- --mode fixture --fixture-dir datasets/fixtures/yabloko-ru
 *   npm run ingest -- --mode live                      # требует сети (CI/локально)
 *   npm run ingest -- --source yabloko-ru --mode fixture
 */

interface Args {
  mode: 'live' | 'fixture';
  source?: string;
  db: string;
  datasetsDir: string;
  fixtureDir?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = get('mode') === 'live' ? 'live' : 'fixture';
  return {
    mode,
    source: get('source'),
    db: get('db') ?? 'var/yabloko.db',
    datasetsDir: get('datasets-dir') ?? 'datasets/party',
    fixtureDir: get('fixture-dir')
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(process.cwd());
  const dbPath = resolve(repoRoot, args.db);
  const datasetsDir = resolve(repoRoot, args.datasetsDir);

  const db = openDb(dbPath);
  migrate(db);
  seedFromBundle(db, loadSeedDir(datasetsDir));

  const ids = args.source ? [args.source] : registeredConnectors();
  let failed = 0;

  for (const id of ids) {
    const factory = getConnector(id);
    if (!factory) {
      console.error(`Нет коннектора для источника: ${id}`);
      failed += 1;
      continue;
    }
    const sourceRow = db
      .prepare(`SELECT url FROM sources WHERE source_id = ?`)
      .get(id) as { url: string | null } | undefined;
    const registeredUrl = sourceRow?.url ?? null;
    if (!registeredUrl) {
      console.error(`Источник ${id} не зарегистрирован (нет URL)`);
      failed += 1;
      continue;
    }

    const fetchPageFn =
      args.mode === 'fixture'
        ? (url: string, registered: string | null) =>
            fetchPage(url, registered, {
              fetchImpl: createFixtureFetch(
                resolve(repoRoot, args.fixtureDir ?? `datasets/fixtures/${id}`)
              ) as unknown as typeof fetch
            })
        : (url: string, registered: string | null) => fetchPage(url, registered);

    console.log(`→ ${id} (mode=${args.mode})`);
    const result = await runPipeline(db, factory(), {
      mode: args.mode,
      registeredUrl,
      fetchPageFn
    });
    console.log(`  ${result.status}: ${result.detail}`);
    if (result.status === 'failed') failed += 1;
  }

  db.close();
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
