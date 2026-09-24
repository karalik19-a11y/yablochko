import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  openDb,
  migrate,
  loadSeedDir,
  seedFromBundle,
  seedGeography,
  loadRfGeoFile,
  getGeoTree,
  getGeoChildren,
  getGeoNode,
  getGeoPath,
  searchGeo,
  buildSubjectMap,
  loadMetricCatalog,
  seedMetricCatalog,
  seedMetricsDomains,
  generateSyntheticMetrics,
  storeMetrics,
  getTerritoryMetrics,
  getMetricValues,
  compareSubjects,
  getTrustChain,
  syntheticMetricsPresent,
  loadCivicTopics,
  seedCivicTopics,
  generateSyntheticCivic,
  aggregateCivicUp,
  storeCivicAggregates,
  syntheticCivicPresent,
  getCivicOverview,
  loadTopicLinks,
  computePositionMatrix,
  loadElectionsFile,
  seedElections,
  loadPostmortemBlocks,
  seedPostmortemBlocks,
  getPostmortem,
  loadOsintGraph,
  seedOsintGraph,
  getOsintGraph,
  getOsintProfile,
  searchOsintEntities,
  listElections,
  getElection,
  getYablokoFederalHistory,
  getRegionalElections,
  listElectionCandidates,
  getPartyContext,
  listPositionsComputed,
  listDocuments,
  listLeaders,
  listBodies,
  listEvents,
  listCandidates,
  listParticipation,
  listSources,
  getMetaStatus,
  listSourceDocuments,
  listAlerts,
  acknowledgeAlert,
  type Db
} from '@yabloko/data-access';
import { searchDocuments } from '@yabloko/data-access';
import { computeRegistryTimeline, registryStats } from '@yabloko/domain';
import type {
  MetaStatus,
  PartyCandidate,
  PartyDocument,
  PartyEvent,
  PartyLeader,
  PartyBody,
  ElectionParticipation,
  Source
} from '@yabloko/api-contract';
import { createPartyContextRefreshJob, JobRunner } from '@yabloko/ingest';
import { buildRoutes } from './routes.js';

export interface AppOptions {
  dbPath: string;
  datasetsDir: string;
  geoDatasetPath?: string;
  metricsCatalogPath?: string;
  civicTopicsPath?: string;
  positionLinksPath?: string;
  electionsDatasetPath?: string;
  postmortemDatasetPath?: string;
  osintGraphPath?: string;
  /** Отключить генерацию SYNTHETIC-метрик. */
  disableSyntheticMetrics?: boolean;
  /** Отключить генерацию SYNTHETIC-агрегатов настроений. */
  disableSyntheticCivic?: boolean;
  staticDir?: string;
  version: string;
  stage: number;
  stageName: string;
  /** Не запускать фоновые задачи (для тестов). */
  disableJobs?: boolean;
  fetchImpl?: typeof fetch;
}

export const DATA_MODE_NOTE =
  'Данные заполнены seed-набором из INITIAL CONTEXT мастер-плана. Все записи имеют статус UNVERIFIED до подключения официальных источников. Документы источников с fetch_mode=fixture — синтетические тест-снимки.';

const TERRITORY_SECTIONS: Array<{ key: string; title: string; stage: number | null }> = [
  { key: 'demographics', title: 'DEMOGRAPHICS', stage: 5 },
  { key: 'economy', title: 'ECONOMY', stage: 5 },
  { key: 'employment', title: 'EMPLOYMENT', stage: 5 },
  { key: 'income', title: 'INCOME', stage: 5 },
  { key: 'housing', title: 'HOUSING', stage: 5 },
  { key: 'healthcare', title: 'HEALTHCARE', stage: 5 },
  { key: 'education', title: 'EDUCATION', stage: 5 },
  { key: 'transport', title: 'TRANSPORT', stage: 5 },
  { key: 'ecology', title: 'ECOLOGY', stage: 5 },
  { key: 'municipal_services', title: 'MUNICIPAL SERVICES', stage: 5 },
  { key: 'migration', title: 'MIGRATION', stage: 5 },
  { key: 'business', title: 'BUSINESS', stage: 5 },
  { key: 'infrastructure', title: 'INFRASTRUCTURE', stage: 5 },
  { key: 'public_concerns', title: 'PUBLIC CONCERNS', stage: 6 },
  { key: 'media_environment', title: 'MEDIA ENVIRONMENT', stage: 11 },
  { key: 'election_history', title: 'ELECTION HISTORY', stage: 8 },
  { key: 'local_political_events', title: 'LOCAL POLITICAL EVENTS', stage: 9 },
  { key: 'local_public_figures', title: 'LOCAL PUBLIC FIGURES', stage: 10 },
  { key: 'yabloko_activity', title: 'YABLOKO ACTIVITY', stage: 8 }
];

function loadCatalogFromDb(db: Db) {
  const domains = db
    .prepare(`SELECT domain, title, section FROM metrics_domains ORDER BY sort_order`)
    .all() as Array<{ domain: string; title: string; section: string }>;
  const metrics = db
    .prepare(`SELECT metric_code AS code, domain, name, unit FROM metrics_catalog ORDER BY domain, metric_code`)
    .all() as Array<{ code: string; domain: string; name: string; unit: string }>;
  return { domains, metrics };
}

function repoRootGuess(): string {
  return process.cwd();
}

export interface AppHandle {
  app: FastifyInstance;
  db: Db;
  stop: () => void;
}

function metaFor(
  dataMode: 'SEED' | 'SYNTHETIC' | 'LIVE',
  warnings: string[] = []
): { generatedAt: string; dataMode: 'SEED' | 'SYNTHETIC' | 'LIVE'; warnings: string[] } {
  return { generatedAt: new Date().toISOString(), dataMode, warnings };
}

export async function buildApp(opts: AppOptions): Promise<AppHandle> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // --- База данных: migrate + seed (идемпотентно) ---
  let civicMethodology = '';
  let topicLinks = null as ReturnType<typeof loadTopicLinks> | null;
  const db = openDb(opts.dbPath);
  const mig = migrate(db);
  if (mig.appliedIds.length > 0) {
    app.log.info(`Применены миграции: ${mig.appliedIds.join(', ')}`);
  }
  const bundle = loadSeedDir(opts.datasetsDir);
  seedFromBundle(db, bundle);
  if (opts.geoDatasetPath !== null && opts.geoDatasetPath !== undefined) {
    seedGeography(db, loadRfGeoFile(opts.geoDatasetPath));
  }
  if (opts.metricsCatalogPath) {
    const catalog = loadMetricCatalog(opts.metricsCatalogPath);
    seedMetricCatalog(db, catalog);
    seedMetricsDomains(db, catalog);
    if (!opts.disableSyntheticMetrics && !syntheticMetricsPresent(db)) {
      const rf = loadRfGeoFile(opts.geoDatasetPath ?? resolvePath(repoRootGuess(), 'datasets/geo/rf.json'));
      const districts = rf.federal_districts.map((d) => ({ geo_id: d.geo_id }));
      const subjects = rf.subjects.map((s0) => ({
        geo_id: s0.geo_id,
        parent_id: `ru:fd:${s0.fd}`
      }));
      const rows = generateSyntheticMetrics(catalog, subjects, districts, rf.country.geo_id);
      storeMetrics(db, { rows, sourceId: 'synthetic-demo', dataMode: 'SYNTHETIC' });
    }
  }
  if (opts.civicTopicsPath) {
    const civic = loadCivicTopics(opts.civicTopicsPath);
    seedCivicTopics(db, civic);
    civicMethodology = civic.meta.methodology;
    if (opts.positionLinksPath) topicLinks = loadTopicLinks(opts.positionLinksPath);
    if (!opts.disableSyntheticCivic && !syntheticCivicPresent(db)) {
      const rf = loadRfGeoFile(opts.geoDatasetPath ?? resolvePath(repoRootGuess(), 'datasets/geo/rf.json'));
      const subjects = rf.subjects.map((s0) => ({ geo_id: s0.geo_id }));
      // 33 месяца: 2024-01 … 2026-09
      const months: string[] = [];
      for (let y = 2024; y <= 2026; y++) {
        for (let m = 1; m <= 12; m++) {
          const p = `${y}-${String(m).padStart(2, '0')}`;
          if (p >= '2024-01' && p <= '2026-09') months.push(p);
        }
      }
      const subjectRows = generateSyntheticCivic(civic, subjects, months);
      // ФО и страна: агрегация сверху (иерархия передаётся явно)
      const fdMembers = new Map<string, string[]>();
      for (const s0 of rf.subjects) {
        const fd = `ru:fd:${s0.fd}`;
        const arr = fdMembers.get(fd) ?? [];
        arr.push(s0.geo_id);
        fdMembers.set(fd, arr);
      }
      const groups = [...fdMembers.entries()].map(([geo_id, members]) => ({ geo_id, members }));
      groups.push({ geo_id: rf.country.geo_id, members: rf.subjects.map((s0) => s0.geo_id) });
      const upRows = aggregateCivicUp(subjectRows, groups);
      const civicMethodRef =
        'synthetic/civic-v1: детерминированный генератор агрегатов (объём темы × регион-фактор × шум, ' +
        'sentiment-доли из topics.json с джиттером ±3%); НЕ реальные сообщения; ' +
        'pipeline-методология: ' + civic.meta.methodology;
      storeCivicAggregates(db, subjectRows, { sourceId: 'synthetic-civic', methodRef: civicMethodRef });
      storeCivicAggregates(db, upRows, { sourceId: 'synthetic-civic', methodRef: civicMethodRef });
    }
  }
  if (opts.electionsDatasetPath) {
    seedElections(db, loadElectionsFile(opts.electionsDatasetPath), { sourceId: 'synthetic-elections' });
  }
  if (opts.postmortemDatasetPath) {
    seedPostmortemBlocks(db, loadPostmortemBlocks(opts.postmortemDatasetPath));
  }
  let osintMethodology = '';
  if (opts.osintGraphPath) {
    const osint = loadOsintGraph(opts.osintGraphPath);
    seedOsintGraph(db, osint);
    osintMethodology = osint.meta.methodology;
  }

  const timers: NodeJS.Timeout[] = [];

  if (!opts.disableJobs) {
    // --- Фоновая задача: проверка партийных источников ---
    const runner = new JobRunner(db);
    runner.register(createPartyContextRefreshJob(db, { fetchImpl: opts.fetchImpl }));
    runner.restoreFromLog();
    void runner.runDue();
    timers.push(
      setInterval(() => {
        void runner.runDue();
      }, 60_000).unref()
    );
  }

  // --- Маршруты ---
  const unverifiedWarnings = (unverified: number, total: number): string[] => {
    const w: string[] = [
      `Данные — seed из INITIAL CONTEXT (не официальные): ${unverified} записей требуют верификации.`
    ];
    if (total === 0) w.push('INSUFFICIENT DATA: по этому разделу данных нет.');
    return w;
  };

  const routes = buildRoutes({
    partyContext: () => {
      const { context, positionStats } = getPartyContext(db, todayIso());
      return {
        data: context,
        meta: metaFor('SEED', unverifiedWarnings(positionStats.unverified, positionStats.total))
      };
    },
    positions: () => {
      const positions = listPositionsComputed(db, todayIso());
      const raw = positions.map((p) => ({
        position_id: p.position_id,
        topic: p.topic,
        exact_position: p.exact_position,
        date_from: p.date_from,
        date_from_precision: p.date_from_precision,
        date_to: p.date_to,
        source_id: p.source_id,
        party_document_id: p.party_document_id,
        confidence: p.confidence,
        statement_category: p.statement_category,
        verification_status: p.verification_status
      }));
      const timeline = computeRegistryTimeline(raw, todayIso());
      const stats = registryStats(timeline);
      return {
        data: {
          positions,
          conflicts: timeline.conflicts,
          stats: {
            total: stats.total,
            current: stats.current,
            unverified: stats.unverified,
            topics: stats.topics
          }
        },
        meta: metaFor('SEED', unverifiedWarnings(stats.unverified, stats.total))
      };
    },
    documents: () => {
      const items: PartyDocument[] = listDocuments(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    leaders: () => {
      const items: PartyLeader[] = listLeaders(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    bodies: () => {
      const items: PartyBody[] = listBodies(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    events: () => {
      const items: PartyEvent[] = listEvents(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    candidates: () => {
      const items: PartyCandidate[] = listCandidates(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    participation: () => {
      const items: ElectionParticipation[] = listParticipation(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    sources: () => {
      const sources: Source[] = listSources(db);
      const warnings = [
        'Коннекторы исполняются в fixture-режиме (песочница без сети) или live (CI/локально).',
        ...unverifiedWarnings(0, 1).slice(0, 0)
      ];
      return { data: { sources }, meta: metaFor('SEED', warnings) };
    },
    sourceDocuments: (query: { source?: string; limit?: number; offset?: number }) => {
      const page = listSourceDocuments(db, {
        sourceId: query.source,
        limit: query.limit,
        offset: query.offset
      });
      return {
        data: {
          items: page.items,
          total: page.total,
          limit: Math.min(Math.max(query.limit ?? 50, 1), 200),
          offset: Math.max(query.offset ?? 0, 0)
        },
        meta: metaFor('SEED')
      };
    },
    documentSearch: (query: { q?: string }) => {
      const q = (query.q ?? '').slice(0, 200);
      return { data: { query: q, hits: searchDocuments(db, q, 20) }, meta: metaFor('SEED') };
    },
    alerts: (query: { openOnly?: string }) => {
      const openOnly = query.openOnly === 'true';
      const alerts = listAlerts(db, 100, openOnly);
      const openRow = db
        .prepare(`SELECT COUNT(*) AS n FROM alerts WHERE acknowledged_at IS NULL`)
        .get() as { n: number };
      return { data: { alerts, openCount: Number(openRow.n) }, meta: metaFor('SEED') };
    },
    acknowledge: (alertId: string) => acknowledgeAlert(db, alertId),
    geoTree: () => {
      return { data: getGeoTree(db), meta: metaFor('SEED', ['Справочник по официальной классификации РФ; коды ОКТМО добавляются при импорте (Этап 5+).']) };
    },
    geoMap: (q: Record<string, string>) => {
      const fd = q.fd && q.fd.startsWith('ru:fd:') ? q.fd : undefined;
      return { data: buildSubjectMap(db, fd), meta: metaFor('SEED') };
    },
    geoSearch: (q: Record<string, string>) => {
      const query = (q.q ?? '').slice(0, 100);
      return { data: { query, items: searchGeo(db, query) }, meta: metaFor('SEED') };
    },
    metricsCatalog: () => {
      const catalog = loadCatalogFromDb(db);
      return { data: catalog, meta: metaFor('SEED', ['Данные показателей — SYNTHETIC до импорта Росстата (Этап 5, CI/локально).']) };
    },
    metricsTerritory: (geoId: string) => {
      const domains = getTerritoryMetrics(db, geoId);
      if (domains.length === 0) return null;
      const warnings: string[] = [];
      for (const d of domains) {
        for (const m of d.metrics) {
          if (m.provenance.data_mode === 'SYNTHETIC') {
            warnings.push('Показатели территории — SYNTHETIC (тест-генератор), не реальные значения.');
            break;
          }
        }
        if (warnings.length > 0) break;
      }
      return { data: { geo_id: geoId, domains }, meta: metaFor('SEED', warnings) };
    },
    metricsMap: (q: Record<string, string>) => {
      const code = String(q.code ?? 'pop_total');
      const fd = q.fd && q.fd.startsWith('ru:fd:') ? q.fd : undefined;
      return {
        data: { ...getMetricValues(db, code, { fd }), code },
        meta: metaFor('SEED', ['SYNTHETIC-данные (тест-генератор).'])
      };
    },
    metricsCompare: (q: Record<string, string>) => {
      const codes = (String(q.codes ?? 'pop_total,inc_avg_wage_month,labor_unemployment_rate') || '')
        .split(',')
        .map((c) => c.trim())
        .filter((c) => /^[a-z_0-9]+$/i.test(c))
        .slice(0, 6);
      const fd = q.fd && q.fd.startsWith('ru:fd:') ? q.fd : undefined;
      const cmp = compareSubjects(db, codes.length > 0 ? codes : ['pop_total'], { fd });
      return {
        data: { ...cmp, codes: codes.length > 0 ? codes : ['pop_total'] },
        meta: metaFor('SEED', ['SYNTHETIC-данные (тест-генератор).'])
      };
    },
    metricsTrust: (q: Record<string, string>) => {
      const geo = String(q.geo ?? '');
      const code = String(q.code ?? '');
      if (!geo || !code || !/^ru:[a-z_]+:[a-z0-9-_]+$/i.test(geo) || !/^[a-z_0-9]+$/i.test(code)) return null;
      const chain = getTrustChain(db, geo, code);
      if (!chain) return null;
      return {
        data: chain,
        meta: metaFor('SEED', ['Цепочка доказательств: VALUE → DATASET → SOURCE → METHODOLOGY.'])
      };
    },
    positionsMatrix: (q: Record<string, string>) => {
      if (!topicLinks) return null;
      const geo = String(q.geo ?? 'ru:country:ru');
      if (!/^ru:[a-z_]+:[a-z0-9-_]+$/i.test(geo)) return null;
      const monthsRaw = Number(q.months ?? 12);
      const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.round(monthsRaw), 3), 36) : 12;
      const matrix = computePositionMatrix(db, {
        links: topicLinks,
        geoId: geo,
        months,
        methodology: civicMethodology || undefined
      });
      return {
        data: matrix,
        meta: metaFor('SEED', [
          'Категории разведены: позиция — OFFICIAL PARTY STATEMENT; настроения — ANALYSIS (SYNTHETIC); показатели — FACT (SYNTHETIC); сопоставление — MODEL.',
          'Совпадение позиций (согласие) не оценивается: тональность темы ≠ поддержка позиции. Матрица не содержит рекомендаций.'
        ])
      };
    },
    electionsList: (q: Record<string, string>) => {
      const level = ['federal', 'region', 'municipal'].includes(String(q.level)) ? String(q.level) : undefined;
      const region = /^ru:[a-z_]+:[a-z0-9-_]+$/i.test(String(q.region ?? '')) ? String(q.region) : undefined;
      const items = listElections(db, { level, regionGeoId: region });
      return {
        data: { items, total: items.length },
        meta: metaFor('SEED', [
          'Метаданные выборов UNVERIFIED (сверка с ЦИК); числовые результаты SYNTHETIC до импорта.'
        ])
      };
    },
    electionDetail: (q: Record<string, string>) => {
      const id = String(q.id ?? '');
      if (!id || !/^[a-z0-9-]+$/i.test(id)) return null;
      const det = getElection(db, id);
      if (!det) return null;
      return {
        data: det,
        meta: metaFor('SEED', [
          'Каждый результат ссылается на источник; SYNTHETIC-значения заменяются официальными при импорте ЦИК.'
        ])
      };
    },
    electionsYablokoHistory: () => {
      const federal = getYablokoFederalHistory(db);
      return {
        data: { federal, data_mode: federal[0]?.data_mode ?? 'SYNTHETIC' },
        meta: metaFor('SEED', [
          'История партийных списков ГД: проценты/мандаты — SYNTHETIC-приближения до сверки с ЦИК.'
        ])
      };
    },
    electionsRegional: (q: Record<string, string>) => {
      const region = /^ru:[a-z_]+:[a-z0-9-_]+$/i.test(String(q.region ?? '')) ? String(q.region) : undefined;
      const items = getRegionalElections(db, region);
      return {
        data: { items, data_mode: items[0]?.data_mode ?? 'SYNTHETIC' },
        meta: metaFor('SEED', ['Региональная история выборов — SYNTHETIC-пилот до импорта избиркомов.'])
      };
    },
    electionsCandidates: (q: Record<string, string>) => {
      const yablokoOnly = String(q.yabloko ?? '') === '1';
      const id = /^[a-z0-9-]+$/i.test(String(q.election ?? '')) ? String(q.election) : undefined;
      const items = listElectionCandidates(db, { electionId: id, yablokoOnly });
      return {
        data: {
          items,
          note:
            'Кандидаты добавляются ТОЛЬКО из официальных списков (ЦИК/избиркомы/партийные документы); персональные записи не выдумываются и предсказания не строятся.'
        },
        meta: metaFor('SEED', ['Кандидатов в seed нет: ждёт официального импорта (Этап 8).'])
      };
    },
    electionsPostmortem: (q: Record<string, string>) => {
      const id = String(q.election ?? 'ru-gd-2026');
      if (!id || !/^[a-z0-9-]+$/i.test(id)) return null;
      const report = getPostmortem(db, id);
      if (!report) return null;
      return {
        data: report,
        meta: metaFor('SEED', [
          'Четыре несмешиваемых блока: OFFICIAL RESULT / PARTY INTERPRETATION / INDEPENDENT ANALYSIS / MODEL INFERENCE.',
          'Официальные результаты вносятся только из ЦИК/избиркомов; модель не строит прогнозов и не заполняет независимый анализ.'
        ])
      };
    },
    osintGraph: () => {
      return {
        data: getOsintGraph(db, osintMethodology),
        meta: metaFor('SEED', [
          'Только публичные сущности; приватные лица не вносятся (CHECK в схеме).',
          'Каждое ребро несёт evidence-источник; рёбер без доказательства нет.'
        ])
      };
    },
    osintEntity: (q: Record<string, string>) => {
      const id = String(q.id ?? '');
      if (!id || !/^[a-z0-9-]+$/i.test(id)) return null;
      const g = getOsintGraph(db, osintMethodology);
      const profile = getOsintProfile(db, id, g.privacy_note);
      if (!profile) return null;
      return {
        data: profile,
        meta: metaFor('SEED', [
          'Профиль публичной фигуры: IDENTITY → AFFILIATIONS → STATEMENTS → TIMELINE → SOURCES. Не профиль частного лица.'
        ])
      };
    },
    osintSearch: (q: Record<string, string>) => {
      const query = String(q.q ?? '');
      return {
        data: { query, items: searchOsintEntities(db, query) },
        meta: metaFor('SEED', ['Поиск по публичным сущностям (имя/роль/описание).'])
      };
    },
    civicOverview: (q: Record<string, string>) => {
      const geo = String(q.geo ?? '');
      if (!geo || !/^ru:[a-z_]+:[a-z0-9-_]+$/i.test(geo)) return null;
      const monthsRaw = Number(q.months ?? 12);
      const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.round(monthsRaw), 3), 36) : 12;
      const overview = getCivicOverview(db, geo, { months, methodology: civicMethodology });
      if (!overview) return null;
      return {
        data: overview,
        meta: metaFor('SEED', [
          'Настроения — SYNTHETIC-агрегаты (тест-генератор), не реальные сообщения.',
          'Только агрегаты: тексты и персональные записи отсутствуют в схеме (k-анонимность k_min=' + String(overview.k_min) + ').',
          'Классификация тренда — констатация изменения объёма, не оценка.'
        ])
      };
    },
    territory: (geoId: string) => {
      const node = getGeoNode(db, geoId);
      if (!node) return null;
      const path = getGeoPath(db, geoId);
      const parent = node.parent_id ? getGeoNode(db, node.parent_id) : null;
      const children = getGeoChildren(db, geoId);
      const childLabel =
        node.level === 'country'
          ? 'Федеральные округа'
          : node.level === 'federal_district'
            ? 'Субъекты РФ'
            : node.level === 'subject'
              ? 'Муниципальный уровень (пилот, частично)'
              : 'Нижний уровень';
      const sections = TERRITORY_SECTIONS.map((sec) => ({ ...sec, status: 'insufficient_data' as const }));
      return { data: { node, path, parent, children, childLabel, sections }, meta: metaFor('SEED', ['Территориальные показатели подключаются с Этапа 5 (regional_metrics).']) };
    },
    metaStatus: () => {
      const status: MetaStatus = getMetaStatus(
        db,
        opts.dbPath,
        opts.version,
        opts.stage,
        opts.stageName,
        'SEED',
        DATA_MODE_NOTE
      );
      return { data: status, meta: metaFor('SEED') };
    }
  });

  for (const r of routes) {
    if (r.method === 'POST') {
      app.post(r.url, async (req, reply) => {
        const body = (req.body ?? {}) as { alert_id?: string };
        const result = r.postHandler?.(body) ?? { ok: false };
        reply.send(result);
      });
    } else {
      app.get(r.url, async (req, reply) => {
        const q = (req.query ?? {}) as Record<string, string>;
        const params = (req.params ?? {}) as Record<string, string>;
        const payload = r.handler(q, params);
        if (payload === null) {
          reply.code(404).send({ error: 'Территория не найдена' });
          return;
        }
        reply.send(payload);
      });
    }
  }

  // --- Статика собранного SPA ---
  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Неизвестный маршрут API' });
      } else {
        reply.sendFile('index.html');
      }
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      reply.code(404).send({ error: 'Неизвестный маршрут' });
    });
  }

  const stop = () => {
    for (const t of timers) clearInterval(t);
    db.close();
    void app.close();
  };

  return { app, db, stop };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
