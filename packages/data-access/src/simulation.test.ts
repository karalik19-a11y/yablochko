import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  openDb,
  migrate,
  seedFromBundle,
  loadSeedDir,
  seedGeography,
  loadRfGeoFile,
  loadMetricCatalog,
  seedMetricCatalog,
  seedMetricsDomains,
  generateSyntheticMetrics,
  storeMetrics,
  loadScenarioTemplates,
  causalLint,
  causalLintTemplates,
  computeScenario,
  saveScenario,
  listScenarios,
  seedResearchSpaces,
  loadTopicLinks
} from './index.js';

const rfPath = resolve(process.cwd(), 'datasets/geo/rf.json');
const partyDir = resolve(process.cwd(), 'datasets/party');
const templatesPath = resolve(process.cwd(), 'datasets/decision/scenario_templates.json');

function fullDb() {
  const db = openDb(':memory:');
  migrate(db);
  seedFromBundle(db, loadSeedDir(partyDir));
  seedGeography(db, loadRfGeoFile(rfPath));
  const catalog = loadMetricCatalog(resolve(process.cwd(), 'datasets/metrics/catalog.json'));
  seedMetricCatalog(db, catalog);
  seedMetricsDomains(db, catalog);
  const rf = loadRfGeoFile(rfPath);
  storeMetrics(db, {
    rows: generateSyntheticMetrics(
      catalog,
      rf.subjects.map((s) => ({ geo_id: s.geo_id, parent_id: `ru:fd:${s.fd}` })),
      rf.federal_districts.map((d) => ({ geo_id: d.geo_id })),
      rf.country.geo_id
    ),
    sourceId: 'synthetic-demo',
    dataMode: 'SYNTHETIC'
  });
  return db;
}

describe('fixture-шаблоны сценариев', () => {
  it('4 шаблона: 3 привязаны к позициям реестра + baseline; позиции существуют', () => {
    const t = loadScenarioTemplates(templatesPath);
    expect(t.templates).toHaveLength(4);
    const linked = t.templates.filter((x) => x.position_id !== null);
    expect(linked).toHaveLength(3);
    // позиции из шаблонов существуют в реестре (через topic_links → positions)
    const links = loadTopicLinks(resolve(process.cwd(), 'datasets/civic/topic_links.json'));
    const registryTopics = new Set(links.links.map((l) => l.position_topic).filter((x): x is string => x !== null));
    // точную сверку position_id делает API-тест; здесь — структурные проверки
    for (const tpl of t.templates) {
      expect(tpl.parameters.length).toBeGreaterThanOrEqual(1);
      expect(tpl.assumptions.length).toBeGreaterThanOrEqual(3);
      expect(tpl.analogue.label.length).toBeGreaterThan(5);
      expect(tpl.evidence_refs.length).toBeGreaterThanOrEqual(2);
    }
    expect(registryTopics.size).toBeGreaterThan(0);
  });

  it('DoD: каузальный линтер — шаблоны чисты, запрещённые фразы ловятся', () => {
    const t = loadScenarioTemplates(templatesPath);
    expect(causalLintTemplates(t)).toEqual([]);
    // линтер находит запреты
    expect(causalLint('Мера приведёт к снижению бедности')).toHaveLength(1);
    expect(causalLint('Реформа снизит на 10% безработицу')).toHaveLength(1);
    expect(causalLint('Программа обеспечит рост доходов и решит проблему')).toHaveLength(2);
    expect(causalLint('Это гарантирует результат')).toHaveLength(1);
    expect(causalLint('it causes growth and will result in x')).toHaveLength(1);
    // корректная формулировка чиста
    expect(
      causalLint('При предположениях A/B модель оценивает диапазон изменения показателя X–Y')
    ).toEqual([]);
  });
});

const baseInput = () => ({
    template: loadScenarioTemplates(templatesPath).templates[0]!,
    parameterValues: { support_intensity: 80 },
    years: 3,
    baselineTarget: 10.5,
    relatedBaselines: { inc_per_capita_month: 60000, med_life_expectancy: 72.5 },
    relatedUnits: { inc_per_capita_month: 'руб/мес', med_life_expectancy: 'лет' },
    targetUnit: '%',
    seedKey: 'test-key'
  });

describe('computeScenario (детерминированный Монте-Карло)', () => {

  it('p10 ≤ p50 ≤ p90; direct/indirect/second_order присутствуют; базовые линии на месте', () => {
    const r = computeScenario(baseInput());
    expect(r.effects.length).toBeGreaterThanOrEqual(3); // direct + 2 indirect
    const direct = r.effects.find((e) => e.order === 'direct')!;
    expect(direct.baseline_value).toBe(10.5);
    expect(direct.p10!).toBeLessThanOrEqual(direct.p50!);
    expect(direct.p50!).toBeLessThanOrEqual(direct.p90!);
    expect(r.effects.some((e) => e.order === 'indirect')).toBe(true);
    expect(r.effects.some((e) => e.order === 'second_order')).toBe(true);
  });

  it('детерминизм: тот же seed → тот же результат; другой параметр → другой', () => {
    const a = computeScenario(baseInput());
    const b = computeScenario(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = computeScenario({ ...baseInput(), parameterValues: { support_intensity: 20 } });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    const directA = a.effects[0]!;
    const directC = c.effects[0]!;
    // эластичность отрицательная: больше поддержки → ниже бедность (p50)
    expect(directC.p50!).toBeGreaterThan(directA.p50!);
  });

  it('DoD: формулировка результата — «при предположениях… модель оценивает диапазон» без каузальности', () => {
    const r = computeScenario(baseInput());
    expect(r.wording).toContain('При предположениях');
    expect(r.wording).toContain('модель оценивает диапазон');
    expect(r.wording).toContain('p10=');
    expect(r.wording).toContain('не прогноз, не причинность и не рекомендация');
    expect(causalLint(r.wording)).toEqual([]);
    expect(r.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(r.methodology).toContain('Монте-Карло');
    expect(r.methodology).toContain('p10/p50/p90');
  });

  it('sensitivity: p50 на границах параметра различаются по знаку эластичности', () => {
    const r = computeScenario(baseInput());
    expect(r.sensitivity).toHaveLength(1);
    const s = r.sensitivity[0]!;
    // эластичность −0.08: min → выше p50, max → ниже
    expect(s.p50_at_min).toBeGreaterThan(s.p50_at_max);
  });

  it('горизонт влияет на накопление (6 лет > 2 лет по |p50 − baseline|)', () => {
    const short = computeScenario({ ...baseInput(), years: 2 });
    const long = computeScenario({ ...baseInput(), years: 6 });
    const dShort = Math.abs(short.effects[0]!.p50! - 10.5);
    const dLong = Math.abs(long.effects[0]!.p50! - 10.5);
    expect(dLong).toBeGreaterThan(dShort);
  });
});

describe('хранение сценариев и пространств', () => {
  it('saveScenario: вычисленный сценарий сохраняется, читается, линтер отклоняет каузальный заголовок', () => {
    const db = fullDb();
    seedResearchSpaces(db, [
      { space_id: 'sp-policy-lab', title: 'Yabloko Policy Lab', description: 'Сценарии на позициях реестра' }
    ]);
    const r = computeScenario(baseInput());
    saveScenario(db, {
      scenario_id: 'sc-test-1',
      space_id: 'sp-policy-lab',
      title: 'Сценарий поддержки доходов: диапазоны',
      scenario_kind: 'policy_lab',
      geo_id: 'ru:country:ru',
      policy_source: 'position:pos-2026-svobody',
      position_id: 'pos-2026-svobody',
      time_horizon_years: 3,
      target_metric: 'inc_poverty_share',
      assumptions: r.assumptions,
      methodology: r.methodology,
      results: r,
      evidence: { refs: ['regional_metrics:inc_poverty_share'] },
      status: 'computed',
      source_id: 'synthetic-media'
    });
    const list = listScenarios(db, 'sp-policy-lab');
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('computed');
    expect(JSON.parse(list[0]!.results_json!)).toHaveProperty('effects');

    // каузальный заголовок отклоняется
    expect(() =>
      saveScenario(db, {
        scenario_id: 'sc-bad',
        space_id: null,
        title: 'Реформа снизит на 30% бедность',
        scenario_kind: 'counterfactual',
        geo_id: null,
        policy_source: 'custom',
        position_id: null,
        time_horizon_years: 3,
        target_metric: 'inc_poverty_share',
        assumptions: ['a'],
        methodology: r.methodology,
        results: null,
        evidence: null,
        status: 'draft',
        source_id: 'synthetic-media'
      })
    ).toThrow(/Каузальная формулировка/);
  });

  it('CHECK схемы: методология короче 40 символов отклоняется', () => {
    const db = fullDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO scenarios (scenario_id, title, scenario_kind, policy_source, time_horizon_years,
           target_metric, assumptions_json, methodology, status, source_id, created_at, updated_at)
           VALUES ('bad-sc', 'x', 'baseline', 'custom', 3, 'inc_poverty_share', '[]', 'коротко', 'draft', 'synthetic-media', 'x', 'x')`
        )
        .run()
    ).toThrow();
    // недопустимый kind отклоняется
    expect(() =>
      db
        .prepare(
          `INSERT INTO scenarios (scenario_id, title, scenario_kind, policy_source, time_horizon_years,
           target_metric, assumptions_json, methodology, status, source_id, created_at, updated_at)
           VALUES ('bad-sc2', 'x', 'prediction', 'custom', 3, 'inc_poverty_share',
           '[]', '${'м'.repeat(50)}', 'draft', 'synthetic-media', 'x', 'x')`
        )
        .run()
    ).toThrow();
  });
});
