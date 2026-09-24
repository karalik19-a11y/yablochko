import { z } from 'zod';

/**
 * Media Intelligence (Этап 11): мониторинг публикаций. Модель публикации:
 * издание, дата, автор, тема, упоминание «ЯБЛОКО», sentiment С МЕТОДОЛОГИЕЙ
 * (ярлык без сноски невозможен — CHECK в схеме), claims. До реального
 * импорта — SYNTHETIC-корпус (фиктивные издания, grade D).
 */

export const MediaArticleRow = z.object({
  article_id: z.string(),
  outlet_id: z.string(),
  outlet_name: z.string(),
  outlet_kind: z.string(),
  title: z.string(),
  published_at: z.string(),
  author: z.string().nullable(),
  url: z.string().nullable(),
  topic_id: z.string().nullable(),
  topic_name: z.string().nullable(),
  mentions_yabloko: z.boolean(),
  mention_context: z.enum(['positive', 'neutral', 'negative', 'unclear']).nullable(),
  /** Методологическая сноска sentiment: обязательна при ярлыке. */
  sentiment_methodology: z.string().nullable(),
  claim_note: z.string().nullable(),
  source_id: z.string(),
  data_mode: z.string(),
  verification_status: z.string()
});
export type MediaArticleRow = z.infer<typeof MediaArticleRow>;

export const MediaMentions = z.object({
  items: z.array(MediaArticleRow),
  total: z.number().int(),
  mentions: z.number().int(),
  context_split: z.object({
    positive: z.number().int(),
    neutral: z.number().int(),
    negative: z.number().int(),
    unclear: z.number().int()
  }),
  methodology: z.string()
});
export type MediaMentions = z.infer<typeof MediaMentions>;

export const MediaTopicsSummary = z.object({
  items: z.array(
    z.object({
      topic_id: z.string(),
      topic_name: z.string(),
      articles: z.number().int(),
      mentions: z.number().int(),
      context_split: z.object({
        positive: z.number().int(),
        neutral: z.number().int(),
        negative: z.number().int(),
        unclear: z.number().int()
      }),
      neg_share_pct: z.number().nullable()
    })
  ),
  methodology: z.string(),
  total_articles: z.number().int(),
  total_mentions: z.number().int()
});
export type MediaTopicsSummary = z.infer<typeof MediaTopicsSummary>;

export const MediaTrend = z.object({
  points: z.array(
    z.object({
      period: z.string(),
      articles: z.number().int(),
      mentions: z.number().int(),
      share_pct: z.number().nullable()
    })
  ),
  methodology: z.string()
});
export type MediaTrend = z.infer<typeof MediaTrend>;

export const MediaSources = z.object({
  outlets: z.array(
    z.object({
      outlet_id: z.string(),
      name: z.string(),
      kind: z.string(),
      articles: z.number().int(),
      mentions: z.number().int(),
      data_mode: z.string()
    })
  ),
  claims: z.array(
    z.object({
      claim_id: z.string(),
      claim_text: z.string(),
      claim_category: z.string(),
      source_id: z.string()
    })
  ),
  note: z.string()
});
export type MediaSources = z.infer<typeof MediaSources>;
