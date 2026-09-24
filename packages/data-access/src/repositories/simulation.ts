import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';

/**
 * Decision Lab / ALADDIN (Этап 12): statistical policy simulation engine.
 *
 * КОНВЕЙЕР: policy → assumptions → historical analogue → affected indicators →
 * baseline → counterfactual → model (детерминированный Монте-Карло) →
 * direct/indirect/second-order → sensitivity → p10/p50/p90 → uncertainty →
 * evidence.
 *
 * Формулировка результата — ТОЛЬКО «при предположениях A/B/C модель оценивает
 * диапазон X–Y». Каузальные утверждения без методологии запрещены
 * (лексический линтер causalLint — DoD-тест).
 * Это НЕ прогноз и не рекомендация: модельная оценка диапазонов по эластичностям.
 */

// ---------- Шаблоны сценариев (fixture) ----------

export const ScenarioTemplate = z.object({
  template_id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Официальная позиция реестра, к которой привязан шаблон Policy Lab. */
  position_id: z.string().nullable(),
  target_metric: z.string(),
  /** Метрики для indirect/second-order эффектов. */
  related_metrics: z.array(z.string()).default([]),
  /** Исторический аналог (период, описание, источник-ссылка на данные). */
  analogue: z.object({
    label: z.string(),
    description: z.string(),
    period: z.string()
  }),
  /** Параметры политики с диапазонами (sensitivity). */
  parameters: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      min: z.number(),
      max: z.number(),
      default: z.number(),
      unit: z.string()
    })
  ),
  /** Фиксированные предположения (перечисляются в каждом результате). */
  assumptions: z.array(z.string()),
  /** Эластичность цели по параметру (при p=-1..1 относительно default). */
  elasticity: z.number(),
  /** Косвенные эффекты: метрика → коэффициент от изменения цели (доля p50 в %). */
  indirect: z
    .array(
      z.object({
        metric: z.string(),
        coefficient: z.number()
      })
    )
    .default([]),
  evidence_refs: z.array(z.string()).default([])
});
export type ScenarioTemplate = z.infer<typeof ScenarioTemplate>;

export const ScenarioTemplatesFile = z.object({
  meta: z
    .object({
      note: z.string(),
      methodology: z.string(),
      model_disclaimer: z.string()
    })
    .passthrough(),
  templates: z.array(ScenarioTemplate)
});
export type ScenarioTemplatesFile = z.infer<typeof ScenarioTemplatesFile>;

export function loadScenarioTemplates(path: string): ScenarioTemplatesFile {
  return ScenarioTemplatesFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

// ---------- Каузальный линтер (DoD) ----------

/**
 * Запрещённые каузальные формулировки без методологии. Возвращает список
 * найденных нарушений (пусто = OK). Применяется к текстам шаблонов и
 * к сгенерированным выводам.
 */
const CAUSAL_BANNED: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /привед[её]т к/i, label: '«приведёт к» — прямое каузальное утверждение' },
  { pattern: /снизит[ося]* на/i, label: '«снизит на» — обещание результата' },
  { pattern: /повысит[ося]* на/i, label: '«повысит на» — обещание результата' },
  { pattern: /даст возможность/i, label: '«даст возможность» — обещание' },
  { pattern: /обеспечит/i, label: '«обеспечит» — гарантия результата' },
  { pattern: /гарантиру[ею]т/i, label: '«гарантирует» — гарантия результата' },
  { pattern: /because of|causes|will result in/i, label: 'англ. каузальность' },
  { pattern: /решит проблему/i, label: '«решит проблему» — обещание' },
  { pattern: /эффект будет/i, label: '«эффект будет» — гарантия' }
];

export function causalLint(text: string): string[] {
  return CAUSAL_BANNED.filter((b) => b.pattern.test(text)).map((b) => b.label);
}

export function causalLintTemplates(file: ScenarioTemplatesFile): Array<{ template_id: string; violations: string[] }> {
  const out: Array<{ template_id: string; violations: string[] }> = [];
  for (const t of file.templates) {
    const violations = [
      ...causalLint(t.title),
      ...causalLint(t.description),
      ...t.assumptions.flatMap((a) => causalLint(a)),
      ...causalLint(file.meta.model_disclaimer)
    ];
    if (violations.length > 0) out.push({ template_id: t.template_id, violations });
  }
  return out;
}

// ---------- Детерминированный Монте-Карло ----------

/** mulberry32 — детерминированный ГПСЧ (тот же, что в metrics-генераторе). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export interface ScenarioInput {
  template: ScenarioTemplate;
  /** Значения параметров (ключ → значение в единицах шаблона). */
  parameterValues: Record<string, number>;
  /** Годовой темп инфляции/роста для номинальных метрик (доля, 0.04 = 4%/год). */
  nominalDrift?: number;
  years?: number;
  seedKey?: string;
  /** Базовая линия целевой метрики (из regional_metrics). */
  baselineTarget?: number | null;
  relatedBaselines?: Record<string, number | null>;
  relatedUnits?: Record<string, string>;
  targetUnit?: string;
  modelNote?: string;
}

export interface MetricEffect {
  metric: string;
  order: 'direct' | 'indirect' | 'second_order';
  baseline_value: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  unit: string;
  explanation: string;
}

export interface ScenarioResult {
  kind: 'baseline' | 'counterfactual' | 'sensitivity' | 'historical_analogue' | 'policy_lab';
  target_metric: string;
  horizon_years: number;
  effects: MetricEffect[];
  sensitivity: Array<{ parameter: string; label: string; low: number; high: number; p50_at_min: number; p50_at_max: number; unit: string }>;
  assumptions: string[];
  methodology: string;
  /** Обязательная формулировка результата (без каузальности). */
  wording: string;
  model_note: string;
}

/**
 * Модель: изменение цели = эластичность × нормированное отклонение параметра ×
 * случайный шум (σ=30% эффекта, детерминированный по seed) с накоплением по годам
 * горизонта (насыщение: sqrt-затухание прироста). Пессимистичный/оптимистичный
 * хвост — p10/p90. Всё — ОЦЕНКИ ДИАПАЗОНОВ, не прогноз.
 */
export function computeScenario(input: ScenarioInput): ScenarioResult {
  const { template, parameterValues } = input;
  const years = Math.min(Math.max(input.years ?? 3, 1), 30);
  const seed = hash32(`${input.seedKey ?? template.template_id}|${JSON.stringify(parameterValues)}|${years}`);
  const rnd = mulberry32(seed);
  const drift = input.nominalDrift ?? 0.04;

  // Нормированное отклонение главного параметра (относительно диапазона).
  const main = template.parameters[0];
  const mainVal = parameterValues[main?.key ?? 'x'] ?? main?.default ?? 0;
  const span = main && main.max !== main.min ? main.max - main.min : 1;
  const xNorm = main ? (mainVal - (main?.default ?? 0)) / span : 0; // -0.5..0.5 обычно

  const effects: MetricEffect[] = [];
  const N = 2000;

  const sampleEffect = (base: number | null, elasticity: number, label: string, order: MetricEffect['order'], metric: string, unit: string): MetricEffect => {
    if (base === null) {
      return { metric, order, baseline_value: null, p10: null, p50: null, p90: null, unit, explanation: label };
    }
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      // Накопленный эффект по годам с насыщением: Σ sqrt(k) ≈ horizon * 0.66
      const cum = years * 0.66;
      const noise = 1 + (rnd() - 0.5) * 0.6; // ±30%
      samples.push(base * (1 + drift) ** years * (1 + elasticity * xNorm * cum * noise));
    }
    samples.sort((a, b) => a - b);
    const pick = (q: number) => samples[Math.min(N - 1, Math.max(0, Math.floor(q * N)))] ?? null;
    return {
      metric,
      order,
      baseline_value: base,
      p10: pick(0.1),
      p50: pick(0.5),
      p90: pick(0.9),
      unit,
      explanation: label
    };
  };

  // DIRECT: целевая метрика.
  effects.push(
    sampleEffect(
      input.baselineTarget ?? null,
      template.elasticity * 2, // полный диапазон x ∈ [-0.5, 0.5] → ×2 → [-1, 1] × elasticity
      `Модельная оценка целевого показателя при параметре «${main?.label ?? ''}» = ${mainVal}${main?.unit ?? ''} (отклонение от базового ${main?.default ?? 0})`,
      'direct',
      template.target_metric,
      input.targetUnit ?? ''
    )
  );

  // INDIRECT: коэффициенты от относительного изменения цели.
  for (const ind of template.indirect) {
    effects.push(
      sampleEffect(
        (input.relatedBaselines ?? {})[ind.metric] ?? null,
        template.elasticity * 2 * ind.coefficient,
        `Косвенный эффект через связь с целевым показателем (коэффициент ${ind.coefficient})`,
        'indirect',
        ind.metric,
        (input.relatedUnits ?? {})[ind.metric] ?? ''
      )
    );
  }

  // SECOND-ORDER: полу-сумма косвенных на последнюю метрику (демонстрация механизма).
  if (effects.length >= 3) {
    const last = template.indirect[template.indirect.length - 1];
    if (last) {
      effects.push(
        sampleEffect(
          (input.relatedBaselines ?? {})[last.metric] ?? null,
          template.elasticity * 2 * last.coefficient * 0.25,
          'Эффект второго порядка: затухающее влияние через косвенный канал (коэффициент 0.25)',
          'second_order',
          `${last.metric} (2-й порядок)`,
          (input.relatedUnits ?? {})[last.metric] ?? ''
        )
      );
    }
  }

  // SENSITIVITY: p50 при min/max каждого параметра.
  const sensitivity = template.parameters.map((p) => {
    const at = (value: number): number => {
      const seedP = hash32(`${input.seedKey ?? template.template_id}|${p.key}|${value}|${years}`);
      void seedP;
      const xn = (value - p.default) / (p.max !== p.min ? p.max - p.min : 1);
      const base = effects[0]?.baseline_value ?? 0;
      return base * (1 + drift) ** years * (1 + template.elasticity * 2 * xn * years * 0.66);
    };
    return {
      parameter: p.key,
      label: p.label,
      low: p.min,
      high: p.max,
      p50_at_min: at(p.min),
      p50_at_max: at(p.max),
      unit: p.unit
    };
  });

  const wording =
    `При предположениях (${template.assumptions.join('; ')}) модель оценивает диапазон ` +
    `изменения «${template.target_metric}» за ${years} г.: ` +
    (effects[0]?.p10 !== null && effects[0]?.p90 !== null
      ? `p10=${fmt(effects[0]!.p10)} … p50=${fmt(effects[0]!.p50)} … p90=${fmt(effects[0]!.p90)}. `
      : 'данных базовой линии нет — INSUFFICIENT DATA. ') +
    'Это модельная оценка диапазонов по эластичностям, не прогноз, не причинность и не рекомендация.';

  return {
    kind: 'counterfactual',
    target_metric: template.target_metric,
    horizon_years: years,
    effects,
    sensitivity,
    assumptions: template.assumptions,
    methodology:
      'Методология: исторический аналог — ' + template.analogue.label + ' (' + template.analogue.period + '); ' +
      'эластичность цели по параметру с доверительным интервалом (шум ±30%); детерминированный Монте-Карло ' +
      `(2000 прогонов, seed=${seed}); горизонт ${years} г. с насыщением (Σ√k); p10/p50/p90 — перцентили прогонов. ` +
      (input.modelNote ?? 'SYNTHETIC-базовые линии (grade D).') +
      ' Формулировка: только «при предположениях A/B/C модель оценивает диапазон X–Y».',
    wording,
    model_note: input.modelNote ?? 'SYNTHETIC-базовые линии (grade D).'
  };
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(2);
}

// ---------- Хранение ----------

export const ScenarioRecord = z.object({
  scenario_id: z.string(),
  space_id: z.string().nullable().optional(),
  title: z.string(),
  scenario_kind: z.enum(['baseline', 'counterfactual', 'sensitivity', 'historical_analogue', 'policy_lab']),
  geo_id: z.string().nullable(),
  policy_source: z.string(),
  position_id: z.string().nullable(),
  time_horizon_years: z.number().int(),
  target_metric: z.string(),
  assumptions_json: z.string(),
  methodology: z.string(),
  results_json: z.string().nullable(),
  evidence_json: z.string().nullable(),
  status: z.enum(['draft', 'computed', 'archived'])
});
export type ScenarioRecord = z.infer<typeof ScenarioRecord>;

export function saveScenario(db: Db, input: {
  scenario_id: string;
  space_id: string | null;
  title: string;
  scenario_kind: ScenarioRecord['scenario_kind'];
  geo_id: string | null;
  policy_source: string;
  position_id: string | null;
  time_horizon_years: number;
  target_metric: string;
  assumptions: string[];
  methodology: string;
  results: unknown | null;
  evidence: unknown | null;
  status: 'draft' | 'computed' | 'archived';
  source_id: string;
}): { saved: 1 } {
  // Линтер: каузальные формулировки в методологии/заголовке запрещены.
  const violations = [...causalLint(input.title), ...causalLint(input.methodology)];
  if (violations.length > 0) {
    throw new Error(`Каузальная формулировка без методологии запрещена: ${violations.join('; ')}`);
  }
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO scenarios (scenario_id, space_id, title, scenario_kind, geo_id, policy_source, position_id,
      time_horizon_years, target_metric, assumptions_json, methodology, results_json, evidence_json, status,
      source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scenario_id) DO UPDATE SET title=excluded.title, scenario_kind=excluded.scenario_kind,
      geo_id=excluded.geo_id, policy_source=excluded.policy_source, position_id=excluded.position_id,
      time_horizon_years=excluded.time_horizon_years, target_metric=excluded.target_metric,
      assumptions_json=excluded.assumptions_json, methodology=excluded.methodology,
      results_json=excluded.results_json, evidence_json=excluded.evidence_json, status=excluded.status,
      updated_at=excluded.updated_at`
  ).run(
    input.scenario_id, input.space_id, input.title, input.scenario_kind, input.geo_id, input.policy_source,
    input.position_id, input.time_horizon_years, input.target_metric, JSON.stringify(input.assumptions),
    input.methodology, input.results === null ? null : JSON.stringify(input.results),
    input.evidence === null ? null : JSON.stringify(input.evidence), input.status, input.source_id, ts, ts
  );
  return { saved: 1 };
}

export function listScenarios(db: Db, spaceId?: string): ScenarioRecord[] {
  const rows = (
    spaceId
      ? db.prepare(`SELECT * FROM scenarios WHERE space_id = ? ORDER BY updated_at DESC`).all(spaceId)
      : db.prepare(`SELECT * FROM scenarios ORDER BY updated_at DESC`).all()
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    scenario_id: String(r.scenario_id),
    space_id: (r.space_id as string | null) ?? null,
    title: String(r.title),
    scenario_kind: r.scenario_kind as ScenarioRecord['scenario_kind'],
    geo_id: (r.geo_id as string | null) ?? null,
    policy_source: String(r.policy_source),
    position_id: (r.position_id as string | null) ?? null,
    time_horizon_years: Number(r.time_horizon_years),
    target_metric: String(r.target_metric),
    assumptions_json: String(r.assumptions_json),
    methodology: String(r.methodology),
    results_json: (r.results_json as string | null) ?? null,
    evidence_json: (r.evidence_json as string | null) ?? null,
    status: r.status as ScenarioRecord['status']
  }));
}

export function seedResearchSpaces(db: Db, spaces: Array<{ space_id: string; title: string; description: string }>): void {
  const ts = new Date().toISOString();
  const up = db.prepare(
    `INSERT INTO research_spaces (space_id, title, description, owner, created_at, updated_at)
     VALUES (?, ?, ?, 'analyst', ?, ?)
     ON CONFLICT(space_id) DO UPDATE SET title=excluded.title, description=excluded.description, updated_at=excluded.updated_at`
  );
  for (const s of spaces) up.run(s.space_id, s.title, s.description, ts, ts);
}
