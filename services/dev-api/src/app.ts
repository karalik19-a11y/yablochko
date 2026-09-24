import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import {
  openDb,
  migrate,
  loadSeedDir,
  seedFromBundle,
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
  type Db
} from '@yabloko/data-access';
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
  staticDir?: string;
  version: string;
  stage: number;
  stageName: string;
  /** Не запускать фоновые задачи (для тестов). */
  disableJobs?: boolean;
  fetchImpl?: typeof fetch;
}

export const DATA_MODE_NOTE =
  'Данные заполнены seed-набором из INITIAL CONTEXT мастер-плана. Все записи имеют статус UNVERIFIED до подключения официальных источников (Этап 3). Система не выдаёт их за верифицированные данные.';

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
  const db = openDb(opts.dbPath);
  const mig = migrate(db);
  if (mig.appliedIds.length > 0) {
    app.log.info(`Применены миграции: ${mig.appliedIds.join(', ')}`);
  }
  const bundle = loadSeedDir(opts.datasetsDir);
  seedFromBundle(db, bundle);

  const timers: NodeJS.Timeout[] = [];

  if (!opts.disableJobs) {
    // --- Фоновая задача: проверка партийных источников (каркас Этапа 3) ---
    const runner = new JobRunner(db);
    runner.register(
      createPartyContextRefreshJob(db, { fetchImpl: opts.fetchImpl })
    );
    runner.restoreFromLog();
    // Первый запуск сразу, затем проверка раз в минуту.
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
      const meta = metaFor('SEED', [
        items.length === 0
          ? 'INSUFFICIENT DATA: сведений о кандидатах нет (появятся на Этапе 8).'
          : ''
      ]);
      return { data: { items }, meta };
    },
    participation: () => {
      const items: ElectionParticipation[] = listParticipation(db);
      return { data: { items }, meta: metaFor('SEED') };
    },
    sources: () => {
      const sources: Source[] = listSources(db);
      return { data: { sources }, meta: metaFor('SEED') };
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
    app.get(r.url, async (_req, reply) => {
      reply.send(r.handler());
    });
  }

  // --- Статика собранного SPA (для single-port preview/production-lite) ---
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

