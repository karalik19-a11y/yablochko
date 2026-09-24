import { z } from 'zod';
import { IsoDateTime } from './common.js';

/** Системный статус (экран About / индикаторы свежести данных). */
export const MetaStatus = z.object({
  app: z.literal('YABLOKO INTELLIGENCE'),
  version: z.string(),
  stage: z.number().int().nonnegative(),
  stageName: z.string(),
  dataMode: z.enum(['SEED', 'SYNTHETIC', 'LIVE']),
  dataModeNote: z.string(),
  database: z.object({
    engine: z.literal('sqlite'),
    path: z.string(),
    migrationsApplied: z.number().int().nonnegative(),
    lastSeedAt: IsoDateTime.nullable()
  }),
  sources: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    planned: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  jobs: z.object({
    lastPartyContextRefresh: z
      .object({
        status: z.string(),
        startedAt: IsoDateTime,
        finishedAt: IsoDateTime.nullable(),
        detail: z.string().nullable()
      })
      .nullable()
  })
});
export type MetaStatus = z.infer<typeof MetaStatus>;
