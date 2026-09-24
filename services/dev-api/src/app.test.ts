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
  TrustChain,
  CivicOverview,
  PositionMatrix,
  ElectionsList,
  ElectionDetail,
  YablokoElectionHistory,
  RegionalElectionHistory,
  PostmortemReport
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
    metricsCatalogPath: resolve(process.cwd(), 'datasets/metrics/catalog.json'),
    civicTopicsPath: resolve(process.cwd(), 'datasets/civic/topics.json'),
    positionLinksPath: resolve(process.cwd(), 'datasets/civic/topic_links.json'),
    electionsDatasetPath: resolve(process.cwd(), 'datasets/elections/elections.json'),
    postmortemDatasetPath: resolve(process.cwd(), 'datasets/elections/postmortem.json')
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

  it('civic/overview: агрегаты настроек по контракту, INSUFFICIENT при малых n, страж без гео-инъекций', async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: `${API.civicOverview}?geo=${encodeURIComponent('ru:subject:spe')}&months=12`
      });
      expect(res.statusCode).toBe(200);
      const ov = Envelope(CivicOverview).parse(res.json()).data;
      expect(ov.geo_id).toBe('ru:subject:spe');
      expect(ov.k_min).toBe(30);
      expect(ov.window_months).toBe(12);
      expect(ov.data_mode).toBe('SYNTHETIC');
      expect(ov.methodology).toContain('Методология Civic Sentiment Engine');
      expect(ov.topics.length).toBeGreaterThan(0);
      for (const t of ov.topics) {
        expect(t.months).toHaveLength(12);
        expect(['rising', 'declining', 'new', 'stable']).toContain(t.classification);
        // k-анонимность: insufficient согласован с k_min
        expect(t.insufficient).toBe(t.last3_n < ov.k_min);
        // mix не может быть противоречивым
        expect(t.totals.mix.pos + t.totals.mix.neu + t.totals.mix.neg + t.totals.mix.mixed + t.totals.mix.unclear)
          .toBe(t.totals.n);
      }
      // GEO-агрегация: страна ≥ суммы двух субъектов (полная Σ из 89 покрыта repo-тестом)
      const country = await app.inject({
        method: 'GET',
        url: `${API.civicOverview}?geo=${encodeURIComponent('ru:country:ru')}&months=3`
      });
      const cov = Envelope(CivicOverview).parse(country.json()).data;
      const pricesCountry = cov.topics.find((t) => t.topic_id === 'prices');
      expect(pricesCountry).toBeDefined();
      const lastPeriod = pricesCountry!.months[pricesCountry!.months.length - 1]!.period;
      const countryN = pricesCountry!.months.find((mm) => mm.period === lastPeriod)?.n ?? 0;
      let sum2 = 0;
      for (const geoSuffix of ['spe', 'mow']) {
        const r = await app.inject({
          method: 'GET',
          url: `${API.civicOverview}?geo=${encodeURIComponent(`ru:subject:${geoSuffix}`)}&months=3`
        });
        const o = Envelope(CivicOverview).parse(r.json()).data;
        const p = o.topics.find((t) => t.topic_id === 'prices');
        sum2 += p?.months.find((mm) => mm.period === lastPeriod)?.n ?? 0;
      }
      expect(countryN).toBeGreaterThanOrEqual(sum2);
      expect(countryN).toBeGreaterThan(0);

      // валидация: некорректный geo → 404
      const bad = await app.inject({ method: 'GET', url: `${API.civicOverview}?geo=javascript:alert(1)` });
      expect(bad.statusCode).toBe(404);
    });
  });

  it('positions/matrix: категории разведены (позиция ≠ мнение), статусы по правилам', async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: `${API.positionsMatrix}?geo=${encodeURIComponent('ru:country:ru')}`
      });
      expect(res.statusCode).toBe(200);
      const m = Envelope(PositionMatrix).parse(res.json()).data;
      expect(m.rows.length).toBe(14);
      expect(m.k_min).toBe(30);
      expect(m.category_rules.length).toBeGreaterThanOrEqual(4);

      const statuses = m.rows.map((r) => r.comparison.status);
      expect(statuses).toContain('agenda_overlap');
      expect(statuses).toContain('agenda_divergence');

      for (const r of m.rows) {
        // СТРАЖ: opinion никогда не содержит полей/текстов позиции
        const oj = JSON.stringify(r.opinion);
        expect(oj).not.toContain('exact_position');
        // СТРАЖ: позиция всегда помечена категорией
        if (r.position) expect(r.position.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
        // у каждой строки есть оговорки категорий
        expect(r.caveats.length).toBeGreaterThanOrEqual(3);
      }
      // overlap только при наличии позиции
      for (const r of m.rows) {
        if (r.comparison.status === 'agenda_overlap') expect(r.position).not.toBeNull();
      }
      // позиция «Свободы» не связана с темами — не потеряна
      expect(m.unlinked_positions.map((p) => p.topic)).toContain('Свободы');

      // инъекция geo → 404
      const bad = await app.inject({ method: 'GET', url: `${API.positionsMatrix}?geo=javascript:alert(1)` });
      expect(bad.statusCode).toBe(404);
    });
  });

  it('elections: база выборов по контракту, согласованность сумм/процентов, official source', async () => {
    await withApp(async (app) => {
      const list = await app.inject({ method: 'GET', url: API.electionsList });
      const el = Envelope(ElectionsList).parse(list.json()).data;
      expect(el.total).toBe(12);
      expect(el.items.filter((e) => e.level === 'federal')).toHaveLength(9);
      for (const e of el.items) {
        expect(e.official_source_id).toBe('synthetic-elections');
        expect(e.data_mode).toBe('SYNTHETIC');
      }

      const det = await app.inject({ method: 'GET', url: `${API.electionDetail}?id=ru-gd-2021` });
      const d = Envelope(ElectionDetail).parse(det.json()).data;
      expect(d.results).toHaveLength(1);
      expect(d.results[0]!.is_yabloko).toBe(1);
      expect(d.turnout).not.toBeNull();
      // DoD: percent согласован с turnout (±1%)
      const t = d.turnout!;
      expect(Math.abs((t.valid_ballots! * (d.results[0]!.percent ?? 0)) / 100 - (d.results[0]!.votes ?? 0)) /
        Math.max(t.valid_ballots! * (d.results[0]!.percent ?? 0) / 100, 1)).toBeLessThan(0.01);
      // страж: в ответе нет полей предсказаний
      expect(JSON.stringify(d)).not.toContain('predict');
      expect(JSON.stringify(d)).not.toContain('win_probability');
      expect(d.provenance.caveats.length).toBeGreaterThanOrEqual(2);

      const hist = await app.inject({ method: 'GET', url: API.electionsYablokoHistory });
      const h = Envelope(YablokoElectionHistory).parse(hist.json()).data;
      expect(h.federal).toHaveLength(8);
      expect(h.federal[0]!.passed_barrier).toBe(true);
      expect(h.federal[h.federal.length - 1]!.passed_barrier).toBe(false);

      const reg = await app.inject({
        method: 'GET',
        url: `${API.electionsRegional}?region=${encodeURIComponent('ru:subject:spe')}`
      });
      const r = Envelope(RegionalElectionHistory).parse(reg.json()).data;
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.yabloko_seats).toBeGreaterThan(0);

      // валидация: битый id → 404
      const bad = await app.inject({ method: 'GET', url: `${API.electionDetail}?id=..%2Fetc` });
      expect(bad.statusCode).toBe(404);
    });
  });

  it('elections/postmortem: 4 несмешиваемых блока, авто-фаза, DATA QUALITY', async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: `${API.electionsPostmortem}?election=${encodeURIComponent('ru-gd-2026')}`
      });
      expect(res.statusCode).toBe(200);
      const pm = Envelope(PostmortemReport).parse(res.json()).data;
      // песочница: 2026-09-24 > дня выборов 2026-09-20 → постмортем активен (авто-переключение)
      expect(pm.phase).toBe('postmortem');
      expect(pm.blocks.map((b) => b.kind)).toEqual([
        'official_result',
        'party_interpretation',
        'independent_analysis',
        'model_inference'
      ]);
      const party = pm.blocks.find((b) => b.kind === 'party_interpretation')!;
      expect(party.rows.length).toBeGreaterThanOrEqual(2);
      for (const r of party.rows) {
        expect(r.statement_category).toBe('OFFICIAL_PARTY_STATEMENT');
        expect(r.votes).toBeNull();
      }
      const official = pm.blocks.find((b) => b.kind === 'official_result')!;
      expect(official.status).toBe('insufficient_data');
      expect(official.note).toContain('не моделируются');
      // страж: в отчёте нет предсказаний
      expect(JSON.stringify(pm)).not.toContain('prediction');
      expect(pm.data_quality.blocks).toHaveLength(4);
    });
  });

  it('неизвестный API-маршрут — 404 JSON', async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(res.statusCode).toBe(404);
    });
  });
});
