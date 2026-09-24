import { z } from 'zod';

/**
 * Position Matrix (Этап 7): позиция партии ↔ общественное мнение.
 * Категории жёстко разведены (позиция ≠ мнение):
 *   OFFICIAL PARTY STATEMENT — позиция из реестра;
 *   ANALYSIS — агрегаты настроений (не согласие с позицией);
 *   FACT — региональные показатели;
 *   MODEL — сопоставление повестки по зафиксированным правилам.
 * Никаких политических рекомендаций.
 */

export const MatrixPositionBlock = z.object({
  position_id: z.string(),
  topic: z.string(),
  exact_position: z.string(),
  date_from: z.string(),
  date_from_precision: z.string(),
  date_to: z.string().nullable(),
  confidence: z.string(),
  verification_status: z.string(),
  current_status: z.string(),
  statement_category: z.literal('OFFICIAL_PARTY_STATEMENT'),
  source_id: z.string(),
  source_name: z.string().nullable(),
  party_document_id: z.string().nullable(),
  party_document_title: z.string().nullable()
});
export type MatrixPositionBlock = z.infer<typeof MatrixPositionBlock>;

export const MatrixOpinionBlock = z.object({
  civic_topic_id: z.string(),
  topic_name: z.string(),
  data_mode: z.string(),
  last3_n: z.number().int(),
  prev3_n: z.number().int(),
  growth_pct: z.number().nullable(),
  classification: z.enum(['rising', 'declining', 'new', 'stable']),
  insufficient: z.boolean(),
  mix: z.object({
    pos: z.number().int(),
    neu: z.number().int(),
    neg: z.number().int(),
    mixed: z.number().int(),
    unclear: z.number().int()
  }),
  neg_share_pct: z.number().nullable(),
  pos_share_pct: z.number().nullable(),
  questions: z.number().int()
});
export type MatrixOpinionBlock = z.infer<typeof MatrixOpinionBlock>;

export const MatrixRegionalBlock = z.object({
  metric_code: z.string(),
  metric_name: z.string(),
  unit: z.string(),
  latest_period: z.string().nullable(),
  latest_value: z.number().nullable(),
  trend_pct: z.number().nullable(),
  data_mode: z.string()
});
export type MatrixRegionalBlock = z.infer<typeof MatrixRegionalBlock>;

export const MatrixComparison = z.object({
  status: z.enum(['agenda_overlap', 'agenda_divergence', 'uncertainty']),
  /** «Наблюдается / не наблюдается совпадение повестки…»; согласие не оценивается. */
  wording: z.string()
});
export type MatrixComparison = z.infer<typeof MatrixComparison>;

export const MatrixRow = z.object({
  link_id: z.string().nullable(),
  link_note: z.string().nullable(),
  civic_topic_id: z.string(),
  civic_topic_name: z.string(),
  category: z.string().nullable(),
  position: MatrixPositionBlock.nullable(),
  opinion: MatrixOpinionBlock.nullable(),
  regional: z.array(MatrixRegionalBlock),
  comparison: MatrixComparison,
  caveats: z.array(z.string())
});
export type MatrixRow = z.infer<typeof MatrixRow>;

export const PositionMatrix = z.object({
  geo_id: z.string(),
  months: z.number().int(),
  k_min: z.number().int(),
  rows: z.array(MatrixRow),
  unlinked_positions: z.array(z.object({ position_id: z.string(), topic: z.string() })),
  methodology: z.string(),
  comparison_rules: z.string(),
  category_rules: z.array(z.string())
});
export type PositionMatrix = z.infer<typeof PositionMatrix>;
