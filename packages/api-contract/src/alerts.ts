import { z } from 'zod';
import { IsoDateTime } from './common.js';

/** Alert Center. Типы из спецификации; персональных алертов нет. */
export const AlertType = z.enum([
  'NEW_PARTY_DOCUMENT',
  'ELECTION_STATUS_CHANGED',
  'CANDIDATE_STATUS_CHANGED',
  'NEW_PUBLICATION',
  'NEW_DATASET',
  'DATA_ANOMALY',
  'SUDDEN_TOPIC_CHANGE',
  'SUDDEN_SENTIMENT_CHANGE',
  'REGIONAL_ANOMALY',
  'SOURCE_FAILURE',
  'LEGAL_EVENT',
  'MODEL_DRIFT',
  'SYSTEM_EVENT'
]);
export type AlertType = z.infer<typeof AlertType>;

export const Alert = z.object({
  alert_id: z.string(),
  type: AlertType,
  severity: z.enum(['info', 'warn', 'error']),
  title: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  payload_json: z.string().nullable(),
  created_at: IsoDateTime,
  acknowledged_at: IsoDateTime.nullable()
});
export type Alert = z.infer<typeof Alert>;

export const AlertsList = z.object({
  alerts: z.array(Alert),
  openCount: z.number().int().nonnegative()
});
export type AlertsList = z.infer<typeof AlertsList>;
