import { z } from 'zod';

/**
 * Decision Lab / ALADDIN (Этап 12): scenario engine.
 * Результат — ТОЛЬКО «при предположениях A/B/C модель оценивает диапазон X–Y».
 * Каузальные формулировки без методологии запрещены (линтер + CHECK схемы).
 * Эластичности — SYNTHETIC (grade D), не прогноз и не рекомендация.
 */

export const ScenarioTemplateInfo = z.object({
  template_id: z.string(),
  title: z.string(),
  description: z.string(),
  position_id: z.string().nullable(),
  target_metric: z.string(),
  related_metrics: z.array(z.string()),
  analogue: z.object({ label: z.string(), description: z.string(), period: z.string() }),
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
  assumptions: z.array(z.string()),
  evidence_refs: z.array(z.string())
});
export type ScenarioTemplateInfo = z.infer<typeof ScenarioTemplateInfo>;

export const ScenarioTemplatesList = z.object({
  templates: z.array(ScenarioTemplateInfo),
  methodology: z.string(),
  model_disclaimer: z.string()
});
export type ScenarioTemplatesList = z.infer<typeof ScenarioTemplatesList>;

export const MetricEffect = z.object({
  metric: z.string(),
  order: z.enum(['direct', 'indirect', 'second_order']),
  baseline_value: z.number().nullable(),
  p10: z.number().nullable(),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  unit: z.string(),
  explanation: z.string()
});
export type MetricEffect = z.infer<typeof MetricEffect>;

export const ScenarioCompute = z.object({
  kind: z.enum(['baseline', 'counterfactual', 'sensitivity', 'historical_analogue', 'policy_lab']),
  target_metric: z.string(),
  horizon_years: z.number().int(),
  effects: z.array(MetricEffect),
  sensitivity: z.array(
    z.object({
      parameter: z.string(),
      label: z.string(),
      low: z.number(),
      high: z.number(),
      p50_at_min: z.number(),
      p50_at_max: z.number(),
      unit: z.string()
    })
  ),
  assumptions: z.array(z.string()),
  methodology: z.string(),
  /** «При предположениях… модель оценивает диапазон X–Y… не прогноз, не причинность». */
  wording: z.string(),
  model_note: z.string()
});
export type ScenarioCompute = z.infer<typeof ScenarioCompute>;

export const ScenarioListItem = z.object({
  scenario_id: z.string(),
  title: z.string(),
  scenario_kind: z.enum(['baseline', 'counterfactual', 'sensitivity', 'historical_analogue', 'policy_lab']),
  geo_id: z.string().nullable(),
  position_id: z.string().nullable(),
  time_horizon_years: z.number().int(),
  target_metric: z.string(),
  status: z.string()
});
export type ScenarioListItem = z.infer<typeof ScenarioListItem>;

export const ScenarioList = z.object({
  items: z.array(ScenarioListItem),
  comparison_note: z.string()
});
export type ScenarioList = z.infer<typeof ScenarioList>;
