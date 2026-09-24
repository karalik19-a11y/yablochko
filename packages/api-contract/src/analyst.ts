import { z } from 'zod';

/**
 * Контракт YABLOKO ANALYST AI (Этап 13). Формат ответа:
 * ANSWER (blocks с разведёнными категориями) / EVIDENCE / SOURCES /
 * UNCERTAINTY; VERIFY SOURCES — пере-проверка источников по реестру.
 * Категории FACT / PARTY_STATEMENT / ANALYSIS / MODEL не смешиваются.
 */

export const FactCategory = z.enum(['FACT', 'PARTY_STATEMENT', 'ANALYSIS', 'MODEL']);
export type FactCategoryT = z.infer<typeof FactCategory>;

export const AnalystProviderInfo = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  configured: z.boolean(),
  available: z.boolean(),
  note: z.string()
});
export type AnalystProviderInfoT = z.infer<typeof AnalystProviderInfo>;

export const AnalystStatus = z.object({
  active_provider: z.string(),
  degraded_mode: z.boolean(),
  degraded_reason: z.string(),
  providers: z.array(AnalystProviderInfo)
});
export type AnalystStatusT = z.infer<typeof AnalystStatus>;

export const AnalystBlock = z.object({
  category: FactCategory,
  text: z.string()
});
export type AnalystBlockT = z.infer<typeof AnalystBlock>;

export const AnalystEvidenceItem = z.object({
  label: z.string(),
  value_text: z.string(),
  category: FactCategory,
  source_id: z.string(),
  source_name: z.string().nullable()
});
export type AnalystEvidenceItemT = z.infer<typeof AnalystEvidenceItem>;

export const AnalystSourceRef = z.object({
  source_id: z.string(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  grade: z.string().nullable(),
  url_present: z.boolean(),
  checksum_present: z.boolean()
});
export type AnalystSourceRefT = z.infer<typeof AnalystSourceRef>;

export const InjectionHit = z.object({
  pattern_id: z.string(),
  excerpt: z.string()
});
export type InjectionHitT = z.infer<typeof InjectionHit>;

export const AnalystAnswer = z.object({
  question: z.string(),
  intent: z.string(),
  provider_id: z.string(),
  provider_mode: z.enum(['llm', 'local-degraded']),
  blocks: z.array(AnalystBlock),
  evidence: z.array(AnalystEvidenceItem),
  sources: z.array(AnalystSourceRef),
  uncertainty: z.array(z.string()),
  tools_used: z.array(z.string()),
  injections_detected: z.array(InjectionHit)
});
export type AnalystAnswerT = z.infer<typeof AnalystAnswer>;

export const AnalystAskRequest = z.object({
  question: z.string().min(3).max(500)
});
export type AnalystAskRequestT = z.infer<typeof AnalystAskRequest>;

export const VerifySourceCheck = z.object({
  check: z.string(),
  result: z.string(),
  detail: z.string()
});
export type VerifySourceCheckT = z.infer<typeof VerifySourceCheck>;

export const VerifySourceItem = z.object({
  source_id: z.string(),
  found: z.boolean(),
  name: z.string().nullable(),
  checks: z.array(VerifySourceCheck)
});
export type VerifySourceItemT = z.infer<typeof VerifySourceItem>;

export const VerifySourcesReport = z.object({
  items: z.array(VerifySourceItem),
  summary: z.object({
    total: z.number(),
    found: z.number(),
    with_url: z.number(),
    with_checksum: z.number()
  }),
  note: z.string()
});
export type VerifySourcesReportT = z.infer<typeof VerifySourcesReport>;
