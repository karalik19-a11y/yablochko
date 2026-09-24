/**
 * Общие типы предметной области YABLOKO INTELLIGENCE.
 *
 * Непреложные принципы (см. docs/ARCHITECTURE.md §1):
 *  - Каждое партийное утверждение — OFFICIAL PARTY STATEMENT, а не истина.
 *  - Каждая запись имеет источник и статус верификации.
 *  - Конфликты позиций разрешаются временно́й шкалой, старые записи не удаляются.
 */

/** Статус верификации записи по официальному источнику. */
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';

/**
 * Вычисляемый статус позиции в реестре на дату.
 * CURRENT / SUPERSEDED / EXPIRED / UNVERIFIED — по мастер-спецификации.
 * FUTURE — документированное расширение: date_from больше даты расчёта.
 */
export type PositionStatus =
  | 'CURRENT'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'UNVERIFIED'
  | 'FUTURE';

/** Уверенность в точности записи (не в «правильности» позиции). */
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Категория утверждения. Смешение категорий в UI запрещено.
 */
export type StatementCategory =
  | 'FACT'
  | 'DATA'
  | 'ANALYSIS'
  | 'INFERENCE'
  | 'MODEL'
  | 'OFFICIAL_PARTY_STATEMENT';

/** Точность известной даты. */
export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

/** Запись Party Position Registry (хранится в party_positions). */
export interface PartyPositionRecord {
  position_id: string;
  topic: string;
  exact_position: string;
  /** ISO-дата (YYYY-MM-DD) начала действия позиции. */
  date_from: string;
  date_from_precision: DatePrecision;
  /** ISO-дата окончания действия (включительно) или null — бессрочно. */
  date_to: string | null;
  source_id: string;
  party_document_id: string | null;
  confidence: Confidence;
  statement_category: StatementCategory;
  verification_status: VerificationStatus;
}

/** Позиция с вычисленным таймлайн-статусом. */
export interface PartyPositionView extends PartyPositionRecord {
  current_status: PositionStatus;
  /** Если статус SUPERSEDED — position_id записи, заменившей данную. */
  superseded_by: string | null;
  /** Дата, с которой позиция перестала быть актуальной (замена/истечение). */
  effective_to: string | null;
}

/** Информационный конфликт таймлайна (не удаляется, а помечается). */
export interface TimelineConflict {
  topic: string;
  position_id_a: string;
  position_id_b: string;
  kind: 'overlap_same_start' | 'ambiguous_successor';
  note: string;
}

export interface RegistryTimelineResult {
  positions: PartyPositionView[];
  conflicts: TimelineConflict[];
}


/** Сравнение ISO-дат (YYYY-MM-DD) как дат без времени. */
export function compareIsoDate(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Позиция действует на дату `asOf` (date_to — включительно). */
export function isActiveOn(pos: PartyPositionRecord, asOf: string): boolean {
  if (compareIsoDate(pos.date_from, asOf) > 0) return false;
  if (pos.date_to !== null && compareIsoDate(asOf, pos.date_to) > 0) return false;
  return true;
}

