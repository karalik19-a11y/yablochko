import { z } from 'zod';

/**
 * Election Postmortem (Этап 9): четыре НЕСМЕШИВАЕМЫХ блока.
 * OFFICIAL RESULT — официальные результаты с источником;
 * PARTY INTERPRETATION — только OFFICIAL PARTY STATEMENT (без чисел результатов);
 * INDEPENDENT ANALYSIS — внешние данные (наблюдатели/СМИ/суды);
 * MODEL INFERENCE — помеченные модельные вычисления (не результат, не прогноз).
 */

export const PostmortemRow = z.object({
  label: z.string(),
  value: z.string().nullable(),
  votes: z.number().int().nullable(),
  percent: z.number().nullable(),
  seats: z.number().int().nullable(),
  delta_pp: z.number().nullable(),
  source_id: z.string().nullable(),
  source_name: z.string().nullable(),
  data_mode: z.string(),
  statement_category: z.enum(['OFFICIAL_PARTY_STATEMENT', 'FACT', 'ANALYSIS', 'MODEL']).nullable(),
  note: z.string().nullable()
});
export type PostmortemRow = z.infer<typeof PostmortemRow>;

export const PostmortemBlock = z.object({
  kind: z.enum(['official_result', 'party_interpretation', 'independent_analysis', 'model_inference']),
  status: z.enum(['pending', 'ready', 'insufficient_data']),
  title: z.string(),
  note: z.string().nullable(),
  rows: z.array(PostmortemRow),
  methodology: z.string().nullable(),
  data_mode: z.string()
});
export type PostmortemBlock = z.infer<typeof PostmortemBlock>;

export const PostmortemReport = z.object({
  election: z.object({
    election_id: z.string(),
    name: z.string(),
    election_date: z.string(),
    level: z.string(),
    data_mode: z.string(),
    phase: z.enum(['pre', 'election_day', 'postmortem']),
    days_since_election: z.number().int().nullable(),
    previous_election_id: z.string().nullable(),
    previous_name: z.string().nullable()
  }),
  phase: z.enum(['pre', 'election_day', 'postmortem']),
  blocks: z.array(PostmortemBlock),
  data_quality: z.object({
    blocks: z.array(z.object({ kind: z.string(), status: z.string() })),
    synthetic_blocks: z.number().int(),
    unverified_rows: z.number().int(),
    rows_without_source: z.number().int(),
    note: z.string()
  }),
  methodology: z.string()
});
export type PostmortemReport = z.infer<typeof PostmortemReport>;
