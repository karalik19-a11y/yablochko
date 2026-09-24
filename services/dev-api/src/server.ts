import { resolve } from 'node:path';
import { buildApp } from './app.js';

const repoRoot = resolve(process.cwd());
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const { app } = await buildApp({
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'var/yabloko.db'),
  datasetsDir: process.env.DATASETS_DIR ?? resolve(repoRoot, 'datasets/party'),
  geoDatasetPath: process.env.GEO_DATASET ?? resolve(repoRoot, 'datasets/geo/rf.json'),
  metricsCatalogPath: process.env.METRICS_CATALOG ?? resolve(repoRoot, 'datasets/metrics/catalog.json'),
  civicTopicsPath: process.env.CIVIC_TOPICS ?? resolve(repoRoot, 'datasets/civic/topics.json'),
  positionLinksPath: process.env.POSITION_LINKS ?? resolve(repoRoot, 'datasets/civic/topic_links.json'),
  electionsDatasetPath: process.env.ELECTIONS_DATASET ?? resolve(repoRoot, 'datasets/elections/elections.json'),
  postmortemDatasetPath: process.env.POSTMORTEM_DATASET ?? resolve(repoRoot, 'datasets/elections/postmortem.json'),
  osintGraphPath: process.env.OSINT_GRAPH ?? resolve(repoRoot, 'datasets/osint/osint_graph.json'),
  mediaDatasetPath: process.env.MEDIA_DATASET ?? resolve(repoRoot, 'datasets/media/media.json'),
  scenarioTemplatesPath: process.env.SCENARIO_TEMPLATES ?? resolve(repoRoot, 'datasets/decision/scenario_templates.json'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'apps/web-dev/dist'),
  version: '0.2.0',
  stage: 2,
  stageName: 'Ядро YABLOKO Context',
  disableJobs: process.env.DISABLE_JOBS === '1'
});

await app.listen({ port, host });
app.log.info(`YABLOKO INTELLIGENCE dev-api слушает http://${host}:${port}`);
