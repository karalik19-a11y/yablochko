/**
 * Сборка desktop-ресурсов (Этап 15): готовая БД + кэш ответов API.
 *
 * Запуск: npx tsx scripts/build-desktop-resources.ts [outDir]
 * (в CI — apps/desktop/core-rs/resources; локально — var/desktop-resources).
 *
 * Профиль desktop (без Node на чистой Windows):
 *  - БД с полными сидами (миграции + party/geo/metrics/media/osint/elections…);
 *  - таблица api_cache: пре-рендер ответов GET-эндпоинтов через НАСТОЯЩЕЕ
 *    приложение (fastify inject) — нулевое дублирование логики в Rust;
 *  - кэш FAQ AI-аналитика по каноническим запросам (askAnalyst из packages/copilot);
 *  - живое в Rust остаётся: geo/documents/osint search, metrics/compare,
 *    metrics/trust, decision/compute (детерминированный Монте-Карло),
 *    analyst/verify, acknowledge.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../services/dev-api/src/app.js';
import { openDb, loadScenarioTemplates } from '@yabloko/data-access';
import type { Db } from '@yabloko/data-access';
// askAnalyst живёт в copilot (data-access — только шаблоны/БД):
import { askAnalyst as ask } from '../packages/copilot/src/orchestrator.js';

const repoRoot = resolve(import.meta.dirname ?? process.cwd(), '..');
const outDir = resolve(process.argv[2] ?? join(repoRoot, 'var', 'desktop-resources'));
mkdirSync(outDir, { recursive: true });

const dbPath = join(outDir, 'yabloko.db');
const tmpDir = mkdtempSync(join(tmpdir(), 'yabloko-desktop-'));
const seedDbPath = join(tmpDir, 'seed.db');

const DATASETS = {
  datasetsDir: join(repoRoot, 'datasets/party'),
  geoDatasetPath: join(repoRoot, 'datasets/geo/rf.json'),
  metricsCatalogPath: join(repoRoot, 'datasets/metrics/catalog.json'),
  civicTopicsPath: join(repoRoot, 'datasets/civic/topics.json'),
  positionLinksPath: join(repoRoot, 'datasets/civic/topic_links.json'),
  electionsDatasetPath: join(repoRoot, 'datasets/elections/elections.json'),
  postmortemDatasetPath: join(repoRoot, 'datasets/elections/postmortem.json'),
  osintGraphPath: join(repoRoot, 'datasets/osint/osint_graph.json'),
  mediaDatasetPath: join(repoRoot, 'datasets/media/media.json'),
  scenarioTemplatesPath: join(repoRoot, 'datasets/decision/scenario_templates.json')
};

const handle = await buildApp({
  dbPath: seedDbPath,
  version: '0.2.0',
  stage: 15,
  stageName: 'desktop-resource-build',
  disableJobs: true,
  ...DATASETS
});

const app = handle.app;

// --- 1) Гео-сетка для параметризованных эндпоинтов ---
const treeJson = (await app.inject({ method: 'GET', url: '/api/v1/geo/tree' })).json() as {
  data: {
    country: { geo_id: string } | null;
    districts: Array<{ geo_id: string; subjects?: number }>;
  };
};
const geoIds = new Set<string>();
const countryId = treeJson.data.country?.geo_id ?? 'ru:country:ru';
geoIds.add(countryId);
for (const d of treeJson.data.districts ?? []) geoIds.add(d.geo_id);
// Субъекты берём из карты (geo_id в properties); поиск с пустым q вернул бы пусто.
const mapJson = (await app.inject({ method: 'GET', url: '/api/v1/geo/map' })).json() as {
  data: { features?: Array<{ properties?: { geo_id?: string } }> };
};
for (const f of mapJson.data.features ?? []) {
  const g = f.properties?.geo_id;
  if (g) geoIds.add(g);
}

// --- 2) Метрики для кэша карт/доверия ---
const catalogJson = (await app.inject({ method: 'GET', url: '/api/v1/metrics/catalog' })).json() as {
  data: { metrics: Array<{ code: string }> };
};
const metricCodes = (catalogJson.data.metrics ?? []).map((m) => m.code);

// --- 3) Медиа: окна и темы ---
const MONTHS = [6, 12, 21];
const topicsJson = (await app.inject({ method: 'GET', url: '/api/v1/media/topics?months=12' })).json() as {
  data: { items?: Array<{ topic_id: string }> };
};
const topicIds = (topicsJson.data.items ?? []).map((t) => t.topic_id);

// --- 4) Выборы: детальные страницы ---
const electionsJson = (await app.inject({ method: 'GET', url: '/api/v1/elections' })).json() as {
  data: { items?: Array<{ election_id: string }> };
};
const electionIds = (electionsJson.data.items ?? []).map((e) => e.election_id);

// --- 5) OSINT: профили сущностей ---
const osintJson = (await app.inject({ method: 'GET', url: '/api/v1/osint/graph' })).json() as {
  data: { entities?: Array<{ entity_id: string }> };
};
const entityIds = (osintJson.data.entities ?? []).map((e) => e.entity_id);

type Cached = { path: string; payload: unknown };

const cached: Cached[] = [];

function add(path: string, payload: unknown): void {
  cached.push({ path, payload });
}

let okTotal = 0;
async function fetchAdd(path: string): Promise<boolean> {
  const res = await app.inject({ method: 'GET', url: path });
  if (res.statusCode !== 200) {
    console.warn(`SKIP ${res.statusCode} ${path}`);
    return false;
  }
  add(path, res.json());
  okTotal += 1;
  return true;
}

// --- 6) Статические GET-эндпоинты (базовые) ---
const STATIC_PATHS = [
  '/api/v1/meta/status',
  '/api/v1/party/context',
  '/api/v1/party/positions',
  '/api/v1/party/documents',
  '/api/v1/party/leaders',
  '/api/v1/party/bodies',
  '/api/v1/party/events',
  '/api/v1/party/candidates',
  '/api/v1/elections',
  '/api/v1/elections/participation',
  '/api/v1/elections/yabloko-history',
  '/api/v1/elections/postmortem',
  '/api/v1/sources',
  '/api/v1/documents?limit=20',
  '/api/v1/alerts',
  '/api/v1/geo/tree',
  '/api/v1/geo/map',
  '/api/v1/metrics/catalog',
  '/api/v1/osint/graph',
  '/api/v1/media/topics?months=12',
  '/api/v1/media/trend?months=12',
  '/api/v1/media/sources',
  '/api/v1/decision/templates',
  '/api/v1/decision/scenarios?space=sp-policy-lab',
  '/api/v1/analyst/status'
];
for (const p of STATIC_PATHS) {
  await fetchAdd(p);
}

// --- 7) Параметризованная сетка ---
for (const g of geoIds) {
  await fetchAdd(`/api/v1/geo/territory/${encodeURIComponent(g)}`);
  await fetchAdd(`/api/v1/metrics/territory/${encodeURIComponent(g)}`);
  await fetchAdd(`/api/v1/civic/overview?geo=${encodeURIComponent(g)}&months=12`);
  await fetchAdd(`/api/v1/civic/overview?geo=${encodeURIComponent(g)}&months=6`);
}
// media: months × topic × mentions (как в Media.tsx)
for (const m of MONTHS) {
  for (const t of ['', ...topicIds]) {
    for (const on of ['', '&mentions=1']) {
      const q = `months=${m}${t ? `&topic=${encodeURIComponent(t)}` : ''}${on}`;
      await fetchAdd(`/api/v1/media/mentions?${q}`);
    }
  }
}
// тренды/темы медиа для каждого окна (Media.tsx переключает months)
for (const m of MONTHS) {
  await fetchAdd(`/api/v1/media/topics?months=${m}`);
  await fetchAdd(`/api/v1/media/trend?months=${m}`);
}
// карта метрик: каждый код
for (const code of metricCodes) {
  await fetchAdd(`/api/v1/metrics/map?code=${encodeURIComponent(code)}`);
}
// матрица позиций (фиксированный запрос экрана)
await fetchAdd(`/api/v1/positions/matrix?geo=${encodeURIComponent('ru:country:ru')}&months=12`);
// детальные выборы + региональные страницы
for (const id of electionIds) {
  await fetchAdd(`/api/v1/elections/detail?id=${encodeURIComponent(id)}`);
}
for (const g of geoIds) {
  await fetchAdd(`/api/v1/elections/region?region=${encodeURIComponent(g)}`);
}
// профили OSINT
for (const id of entityIds) {
  await fetchAdd(`/api/v1/osint/entity?id=${encodeURIComponent(id)}`);
}

// --- 8) FAQ AI-аналитика (полноценный askAnalyst, кэш точных совпадений) ---
const templates = loadScenarioTemplates(DATASETS.scenarioTemplatesPath);
const FAQ_QUESTIONS = [
  // Должно совпадать с EXAMPLES в packages/app/src/screens/Analyst.tsx
  'Сравни регионы',
  'Что изменилось?',
  'Какие темы выросли в медиа?',
  'Покажи источники',
  'Новые документы партии',
  'Исследование по поддержке инициатив',
  'Смоделируй сценарий'
];
const mediaMethodology =
  ((await app.inject({ method: 'GET', url: '/api/v1/media/sources' })).json() as {
    data?: { methodology?: string };
  }).data?.methodology ?? '';

const faqExact: Record<string, unknown> = {};
{
  // Отдельное read-соединение к уже засеянной БД (WAL видит закоммиченное).
  const faqDb: Db = openDb(seedDbPath);
  for (const q of FAQ_QUESTIONS) {
    const answer = await ask(faqDb, q, {
      mediaMethodology,
      scenarioTemplates: templates.templates
    });
    faqExact[q] = {
      data: answer,
      meta: {
        generatedAt: '__BUILD_TIME__',
        dataMode: 'SEED',
        warnings: [
          'Ответ аналитика: категории FACT / PARTY STATEMENT / ANALYSIS / MODEL разведены.',
          'Данные SYNTHETIC (grade D); модельные оценки — только «при предположениях…».',
          'Desktop-профиль: ответы по каноническим запросам кэшированы при сборке.'
        ]
      }
    };
  }
  faqDb.close();
}

handle.stop();

// --- 9) Перенос БД и запись api_cache ---
{
  const { copyFileSync } = await import('node:fs');
  copyFileSync(seedDbPath, dbPath);
}
rmSync(tmpDir, { recursive: true, force: true });

const buildTime = new Date().toISOString();
const db = openDb(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS api_cache (
    path TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    built_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS build_info (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const insCache = db.prepare(
  `INSERT OR REPLACE INTO api_cache (path, payload_json, built_at) VALUES (?, ?, ?)`
);
const insInfo = db.prepare(`INSERT OR REPLACE INTO build_info (key, value) VALUES (?, ?)`);
db.exec('BEGIN');
for (const { path, payload } of cached) {
  const json = JSON.stringify(payload).replace(/__BUILD_TIME__/g, buildTime);
  insCache.run(path, json, buildTime);
}
// FAQ аналитика — после подстановки времени сборки
for (const [q, envelope] of Object.entries(faqExact)) {
  const json = JSON.stringify(envelope).replace(/__BUILD_TIME__/g, buildTime);
  insCache.run(`POST /api/v1/analyst/ask#${q}`, json, buildTime);
}
insInfo.run('built_at', buildTime);
insInfo.run('profile', 'desktop');
insInfo.run('endpoints', String(cached.length + Object.keys(faqExact).length));
db.exec('COMMIT');
db.exec('VACUUM');
const count = db.prepare('SELECT COUNT(*) AS n FROM api_cache').get() as { n: number };
db.close();
// wal/shm не нужны read-only ядру — не тащим в установщик.
for (const suffix of ['-wal', '-shm']) {
  rmSync(dbPath + suffix, { force: true });
}

// Шаблоны сценариев (полные, с elasticity/indirect) — ресурс Rust-ядра.
copyFileSync(DATASETS.scenarioTemplatesPath, join(outDir, 'scenario_templates.json'));
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ built_at: buildTime, endpoints: okTotal, cache_rows: count.n }, null, 2)
);
console.log(`desktop resources: ${dbPath}`);
console.log(`cache rows: ${count.n} (ok: ${okTotal} requested ${cached.length})`);
console.log(`faq: ${Object.keys(faqExact).length}`);
