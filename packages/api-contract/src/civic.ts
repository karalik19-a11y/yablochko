import { z } from 'zod';

/**
 * Civic Intelligence: ТОЛЬКО агрегаты общественных настроений.
 * Персональные записи и тексты в API отсутствуют архитектурно
 * (см. миграцию 005 и страж-тесты pipeline).
 */

export const CivicMonthPoint = z.object({
  period: z.string(),
  n: z.number().int(),
  pos: z.number().int(),
  neu: z.number().int(),
  neg: z.number().int(),
  mixed: z.number().int(),
  unclear: z.number().int(),
  questions: z.number().int(),
  /** k-анонимность: n < k_min → месяц помечен недостаточной выборкой. */
  insufficient: z.boolean()
});
export type CivicMonthPoint = z.infer<typeof CivicMonthPoint>;

export const CivicTopicSeries = z.object({
  topic_id: z.string(),
  topic_name: z.string(),
  months: z.array(CivicMonthPoint),
  totals: z.object({
    n: z.number().int(),
    questions: z.number().int(),
    mix: z.object({
      pos: z.number().int(),
      neu: z.number().int(),
      neg: z.number().int(),
      mixed: z.number().int(),
      unclear: z.number().int()
    })
  }),
  last3_n: z.number().int(),
  prev3_n: z.number().int(),
  growth_pct: z.number().nullable(),
  /** new / rising (≥+25%) / declining (≤−25%) / stable — констатация изменения объёма. */
  classification: z.enum(['rising', 'declining', 'new', 'stable']),
  /** k-анонимность для last3-окна. */
  insufficient: z.boolean()
});
export type CivicTopicSeries = z.infer<typeof CivicTopicSeries>;

export const CivicOverview = z.object({
  geo_id: z.string(),
  window_months: z.number().int(),
  k_min: z.number().int(),
  data_mode: z.string(),
  methodology: z.string(),
  topics: z.array(CivicTopicSeries),
  total_last3: z.number().int()
});
export type CivicOverview = z.infer<typeof CivicOverview>;

/** Мини-разрез темы для строк списков (Issue Tracker / Territory). */
export const CivicTopicRow = z.object({
  topic_id: z.string(),
  topic_name: z.string(),
  last3_n: z.number().int(),
  growth_pct: z.number().nullable(),
  classification: z.enum(['rising', 'declining', 'new', 'stable']),
  insufficient: z.boolean(),
  neg_share_pct: z.number().nullable()
});
export type CivicTopicRow = z.infer<typeof CivicTopicRow>;
