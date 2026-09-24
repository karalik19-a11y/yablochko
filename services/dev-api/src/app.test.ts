import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from './app.js';
import {
  API,
  MetaStatus,
  PartyContext,
  Source,
  MetricsCatalog,
  MetricMapValues,
  TerritoryMetrics,
  TrustChain
} from '@yabloko/api-contract';
import { z } from 'zod';

const Envelope = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ data: inner, meta: z.object({ generatedAt: z.string(), dataMode: z.string(), warnings: z.array(z.string()) }) });

const datasetsDir = resolve(process.cwd(), 'datasets/party');

// fetch отсутствует в среде тестов -> задачи регистрируются с disableJobs.
async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>['app']) => Promise<void>) {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'yabloko-')), 'test.db');
  const handle = await buildApp({
    dbPath,
    datasetsDir,
    version: '0.2.0-test',
    stage: 2,
    stageName: 'test',
    disableJobs: true,
    geoDatasetPath: resolve(process.cwd(), 'datasets/geo/rf.json'),
    metricsCatalogPath: resolve(process.cwd(), 'datasets/metrics/catalog.json')
  });
  try {
    await fn(handle.app);
  } finally {
    handle.stop();
  }
}

describe('dev-api (интеграция контракта)', () => {
  it('meta/status соответствует контракту', async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: API.metaStatus });
      expect(res.statusCode).toBe(200);
      const parsed = Envelope(MetaStatus).safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.data.app).toBe('YABLOKO INTELLIGENCE');
        expect(parsed.data.data.database.engine).toBe('sqlite');
      }
    });
  });

  it('party/context: seed из datasets парсится контрактом', async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: API.partyContext });
      expect(res.statusCode).toBe(200);
      const parsed = Envelope(PartyContext).safeParse(res.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.data.party.full_name).toContain('ЯБЛОКО');
        expect(parsed.data.data.currentPositions.length).toBeGreaterThan(0);
        expect(parsed.data.meta.warnings.length).toBeGreaterThan(0);
      }
    });
  });

  it('sources: все записи соответствуют схеме Source', async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: API.sources });
      const parsed = Envelope(z.object({ sources: z.array(Source) })).parse(res.json());
      expect(parsed.data.sources.length).toBeGreaterThanOrEqual(4);
      const initial = parsed.data.sources.find((s) => s.source_id === 'initial-context');
      expect(initial?.status).toBe('active');
    });
  });

  it('metrics: каталог, карта, территория, trust соответствуют контракту', async () => {
    await withApp(async (app) => {
      const cat = await app.inject({ method: 'GET', url: API.metricsCatalog });
      expect(Envelope(MetricsCatalog).parse(cat.json()).data.metrics.length).toBe(28);

      const map = await app.inject({ method: 'GET', url: `${API.metricsMap}?code=pop_total` });
      const mv = Envelope(MetricMapValues).parse(map.json()).data;
      expect(mv.values.length).toBe(89);
      expect(mv.data_mode).toBe('SYNTHETIC');

      const terr = await app.inject({
        method: 'GET',
        url: `${API.metricsTerritory}/${encodeURIComponent('ru:subject:spe')}`
      });
      const tm = Envelope(TerritoryMetrics).parse(terr.json()).data;
      expect(tm.domains.length).toBeGreaterThanOrEqual(8);
      const sections = tm.domains.map((d) => d.section);
      for (const sec of ['DEMOGRAPHICS', 'INCOME', 'HOUSING']) {
        expect(sections).toContain(sec);
      }

      const trust = await app.inject({
        method: 'GET',
        url: `${API.metricsTrust}?geo=${encodeURIComponent('ru:subject:spe')}&code=pop_total`
      });
      const tc = Envelope(TrustChain).parse(trust.json()).data;
      expect(tc.dataset.table).toBe('regional_metrics');
      expect(tc.caveats.length).toBeGreaterThan(0);

      // Инъекция в параметры trust отклоняется (null → 404)
      const bad = await app.inject({
        method: 'GET',
        url: `${API.metricsTrust}?geo=javascript:alert(1)&code=pop_total`
      });
      expect(bad.statusCode).toBe(404);
    });
  }, 20000);

  it('неизвестный API-маршрут — 404 JSON', async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(res.statusCode).toBe(404);
    });
  });
});
