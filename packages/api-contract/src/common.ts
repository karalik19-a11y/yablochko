import { z } from 'zod';

/** Примитивы контракта. */

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'ISO datetime');

export const VerificationStatus = z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']);
export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const PositionStatus = z.enum([
  'CURRENT',
  'SUPERSEDED',
  'EXPIRED',
  'UNVERIFIED',
  'FUTURE'
]);
export const StatementCategory = z.enum([
  'FACT',
  'DATA',
  'ANALYSIS',
  'INFERENCE',
  'MODEL',
  'OFFICIAL_PARTY_STATEMENT'
]);
export const DatePrecision = z.enum(['day', 'month', 'year', 'unknown']);

export const VerificationStatusT = z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']);

/** Метаданные конверта ответа. */
export const ResponseMeta = z.object({
  generatedAt: IsoDateTime,
  /** Режим данных: SEED — seed-набор, SYNTHETIC — синтетика, LIVE — реальные источники. */
  dataMode: z.enum(['SEED', 'SYNTHETIC', 'LIVE']),
  warnings: z.array(z.string())
});

export interface Envelope<T> {
  data: T;
  meta: z.infer<typeof ResponseMeta>;
}

export function envelope<T>(data: T, meta: z.infer<typeof ResponseMeta>): Envelope<T> {
  return { data, meta };
}

/** Источник (Source Registry). */
export const Source = z.object({
  source_id: z.string(),
  name: z.string(),
  owner: z.string().nullable(),
  url: z.string().nullable(),
  source_type: z.string(),
  license: z.string().nullable(),
  collection_method: z.string().nullable(),
  coverage: z.string().nullable(),
  period: z.string().nullable(),
  update_frequency: z.string().nullable(),
  reliability: z.object({
    grade: z.string(),
    note: z.string()
  }),
  status: z.enum(['planned', 'active', 'failed', 'retired']),
  update_policy: z.string().nullable(),
  last_update: IsoDateTime.nullable(),
  checksum: z.string().nullable()
});

export type Source = z.infer<typeof Source>;
