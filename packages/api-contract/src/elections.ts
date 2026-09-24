import { z } from 'zod';

/**
 * Election Intelligence (Этап 8): база выборов. Каждая строка результата
 * несёт официальный источник. До импорта ЦИК значения — SYNTHETIC
 * (честные бейджи). Колонок предсказаний/персональных вероятностей нет.
 */

export const ElectionListItem = z.object({
  election_id: z.string(),
  name: z.string(),
  election_date: z.string(),
  level: z.enum(['federal', 'region', 'municipal']),
  region_geo_id: z.string().nullable(),
  election_type: z.string(),
  electoral_system: z.string().nullable(),
  seats_total: z.number().int().nullable(),
  official_source_id: z.string(),
  data_mode: z.string(),
  verification_status: z.string()
});
export type ElectionListItem = z.infer<typeof ElectionListItem>;

export const ElectionsList = z.object({
  items: z.array(ElectionListItem),
  total: z.number().int()
});
export type ElectionsList = z.infer<typeof ElectionsList>;

export const ElectionResultRow = z.object({
  result_id: z.string(),
  district_id: z.string().nullable(),
  party_name: z.string().nullable(),
  is_party_list: z.number().int(),
  is_yabloko: z.number().int(),
  votes: z.number().int(),
  percent: z.number().nullable(),
  seats: z.number().int().nullable()
});
export type ElectionResultRow = z.infer<typeof ElectionResultRow>;

export const ElectionDetail = ElectionListItem.extend({
  note: z.string().nullable(),
  results: z.array(ElectionResultRow),
  turnout: z
    .object({
      voters_registered: z.number().int(),
      ballots_cast: z.number().int(),
      valid_ballots: z.number().int().nullable(),
      percent: z.number()
    })
    .nullable(),
  provenance: z.object({
    source_id: z.string(),
    data_mode: z.string(),
    verification_status: z.string(),
    caveats: z.array(z.string())
  })
});
export type ElectionDetail = z.infer<typeof ElectionDetail>;

export const YablokoHistoryPoint = z.object({
  election_id: z.string(),
  name: z.string(),
  election_date: z.string(),
  percent: z.number().nullable(),
  votes: z.number().int().nullable(),
  seats: z.number().int().nullable(),
  passed_barrier: z.boolean().nullable(),
  data_mode: z.string()
});
export type YablokoHistoryPoint = z.infer<typeof YablokoHistoryPoint>;

export const YablokoElectionHistory = z.object({
  federal: z.array(YablokoHistoryPoint),
  data_mode: z.string()
});
export type YablokoElectionHistory = z.infer<typeof YablokoElectionHistory>;

export const RegionalElectionRow = z.object({
  election_id: z.string(),
  name: z.string(),
  election_date: z.string(),
  region_geo_id: z.string().nullable(),
  yabloko_percent: z.number().nullable(),
  yabloko_seats: z.number().int().nullable(),
  seats_total: z.number().int().nullable(),
  turnout_percent: z.number().nullable(),
  data_mode: z.string()
});
export type RegionalElectionRow = z.infer<typeof RegionalElectionRow>;

export const RegionalElectionHistory = z.object({
  items: z.array(RegionalElectionRow),
  data_mode: z.string()
});
export type RegionalElectionHistory = z.infer<typeof RegionalElectionHistory>;

export const ElectionCandidatesList = z.object({
  items: z.array(
    z.object({
      candidate_id: z.string(),
      election_id: z.string(),
      district_id: z.string().nullable(),
      person_name: z.string(),
      party_name: z.string().nullable(),
      is_yabloko: z.boolean(),
      registration_status: z.string().nullable(),
      verification_status: z.string()
    })
  ),
  note: z.string()
});
export type ElectionCandidatesList = z.infer<typeof ElectionCandidatesList>;
