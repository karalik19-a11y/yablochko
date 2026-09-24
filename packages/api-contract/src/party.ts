import { z } from 'zod';
import {
  Confidence,
  DatePrecision,
  IsoDate,
  PositionStatus,
  StatementCategory,
  VerificationStatus
} from './common.js';

/**
 * Партийный контекст: Party, PartyLeader, PartyBody, PartyDocument,
 * PartyPosition, PartyEvent, PartyCandidate, ElectionParticipation.
 *
 * Каждое партийное утверждение переносится как OFFICIAL PARTY STATEMENT
 * (statement_category), UI обязан отображать это отдельно от фактов.
 */

export const Party = z.object({
  party_id: z.string(),
  short_name: z.string(),
  full_name: z.string(),
  status_note: z.string().nullable(),
  source_id: z.string(),
  source_name: z.string().nullable(),
  verification_status: VerificationStatus
});
export type Party = z.infer<typeof Party>;

export const PartyBody = z.object({
  body_id: z.string(),
  name: z.string(),
  body_type: z.string(),
  description: z.string().nullable(),
  source_id: z.string(),
  verification_status: VerificationStatus
});
export type PartyBody = z.infer<typeof PartyBody>;

export const PartyLeader = z.object({
  leader_id: z.string(),
  person_name: z.string(),
  role_title: z.string(),
  body_id: z.string().nullable(),
  body_name: z.string().nullable(),
  date_from: IsoDate.nullable(),
  date_to: IsoDate.nullable(),
  date_note: z.string().nullable(),
  source_id: z.string(),
  confidence: Confidence,
  verification_status: VerificationStatus
});
export type PartyLeader = z.infer<typeof PartyLeader>;

export const PartyDocument = z.object({
  doc_id: z.string(),
  doc_type: z.string(),
  title: z.string(),
  doc_date: IsoDate.nullable(),
  date_precision: DatePrecision,
  issuer: z.string().nullable(),
  summary: z.string().nullable(),
  source_id: z.string(),
  source_name: z.string().nullable(),
  verification_status: VerificationStatus
});
export type PartyDocument = z.infer<typeof PartyDocument>;

export const PartyPosition = z.object({
  position_id: z.string(),
  topic: z.string(),
  exact_position: z.string(),
  date_from: IsoDate,
  date_from_precision: DatePrecision,
  date_to: IsoDate.nullable(),
  source_id: z.string(),
  source_name: z.string().nullable(),
  party_document_id: z.string().nullable(),
  party_document_title: z.string().nullable(),
  confidence: Confidence,
  statement_category: StatementCategory,
  verification_status: VerificationStatus,
  current_status: PositionStatus,
  superseded_by: z.string().nullable(),
  effective_to: IsoDate.nullable()
});
export type PartyPosition = z.infer<typeof PartyPosition>;

export const PartyEvent = z.object({
  event_id: z.string(),
  title: z.string(),
  event_type: z.string(),
  event_date: IsoDate.nullable(),
  date_precision: DatePrecision,
  description: z.string().nullable(),
  source_id: z.string(),
  verification_status: VerificationStatus
});
export type PartyEvent = z.infer<typeof PartyEvent>;

export const PartyCandidate = z.object({
  candidate_id: z.string(),
  person_name: z.string(),
  level: z.string(),
  region_label: z.string().nullable(),
  election_id: z.string().nullable(),
  registration_status: z.string().nullable(),
  source_id: z.string(),
  verification_status: VerificationStatus
});
export type PartyCandidate = z.infer<typeof PartyCandidate>;

export const ElectionParticipation = z.object({
  participation_id: z.string(),
  election_id: z.string().nullable(),
  election_name: z.string(),
  election_date: IsoDate.nullable(),
  level: z.string(),
  region_label: z.string().nullable(),
  participation_type: z.string(),
  result_summary: z.string().nullable(),
  source_id: z.string(),
  verification_status: VerificationStatus
});
export type ElectionParticipation = z.infer<typeof ElectionParticipation>;

/** Сводка YABLOKO TODAY (агрегат для главного экрана). */
export const PartyContext = z.object({
  party: Party,
  leaders: z.array(PartyLeader),
  bodies: z.array(PartyBody),
  currentPositions: z.array(PartyPosition),
  latestDocuments: z.array(PartyDocument),
  events: z.array(PartyEvent),
  candidates: z.object({
    count: z.number().int().nonnegative(),
    note: z.string()
  }),
  electionParticipation: z.object({
    count: z.number().int().nonnegative(),
    note: z.string()
  }),
  stats: z.object({
    positionsTotal: z.number().int().nonnegative(),
    positionsCurrent: z.number().int().nonnegative(),
    positionsUnverified: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    documentsCount: z.number().int().nonnegative(),
    eventsCount: z.number().int().nonnegative(),
    leadersCount: z.number().int().nonnegative(),
    bodiesCount: z.number().int().nonnegative()
  })
});
export type PartyContext = z.infer<typeof PartyContext>;

// --- Параметры запросов -------------------------------------------------

export const PositionsQuery = z.object({
  topic: z.string().optional(),
  status: PositionStatus.optional(),
  includeHistory: z.enum(['true', 'false']).default('true')
});
export type PositionsQuery = z.infer<typeof PositionsQuery>;
