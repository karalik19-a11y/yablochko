import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

/**
 * Alert Center (хранилище). Типы по спецификации; персональных алертов
 * по частным лицам не существует архитектурно.
 */

export type AlertType =
  | 'NEW_PARTY_DOCUMENT'
  | 'ELECTION_STATUS_CHANGED'
  | 'CANDIDATE_STATUS_CHANGED'
  | 'NEW_PUBLICATION'
  | 'NEW_DATASET'
  | 'DATA_ANOMALY'
  | 'SUDDEN_TOPIC_CHANGE'
  | 'SUDDEN_SENTIMENT_CHANGE'
  | 'REGIONAL_ANOMALY'
  | 'SOURCE_FAILURE'
  | 'LEGAL_EVENT'
  | 'MODEL_DRIFT'
  | 'SYSTEM_EVENT';

export type AlertSeverity = 'info' | 'warn' | 'error';

export interface AlertRecord {
  alert_id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface RecordAlertInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  /** Не создавать дубликат, если есть неоткрытый алерт того же типа/сущности. */
  dedupOpen?: boolean;
}

export function recordAlert(db: Db, input: RecordAlertInput): AlertRecord | null {
  if (input.dedupOpen !== false) {
    const existing = db
      .prepare(
        `SELECT alert_id FROM alerts
         WHERE type = ? AND IFNULL(entity_id,'') = IFNULL(?,'') AND acknowledged_at IS NULL`
      )
      .get(input.type, input.entityId ?? null) as { alert_id: string } | undefined;
    if (existing) return null;
  }
  const alert: AlertRecord = {
    alert_id: `alert-${randomUUID()}`,
    type: input.type,
    severity: input.severity,
    title: input.title,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    payload_json: input.payload ? JSON.stringify(input.payload) : null,
    created_at: new Date().toISOString(),
    acknowledged_at: null
  };
  db.prepare(
    `INSERT INTO alerts (alert_id, type, severity, title, entity_type, entity_id, payload_json, created_at, acknowledged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    alert.alert_id,
    alert.type,
    alert.severity,
    alert.title,
    alert.entity_type,
    alert.entity_id,
    alert.payload_json,
    alert.created_at,
    alert.acknowledged_at
  );
  return alert;
}

export function listAlerts(db: Db, limit = 100, openOnly = false): AlertRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM alerts ${openOnly ? 'WHERE acknowledged_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(mapAlert);
}

export function acknowledgeAlert(db: Db, alertId: string): boolean {
  const r = db
    .prepare(`UPDATE alerts SET acknowledged_at = ? WHERE alert_id = ? AND acknowledged_at IS NULL`)
    .run(new Date().toISOString(), alertId);
  return Number(r.changes) > 0;
}

export function mapAlert(r: Record<string, unknown>): AlertRecord {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    alert_id: str(r.alert_id) ?? '',
    type: (str(r.type) ?? 'SYSTEM_EVENT') as AlertType,
    severity: (str(r.severity) ?? 'info') as AlertSeverity,
    title: str(r.title) ?? '',
    entity_type: str(r.entity_type),
    entity_id: str(r.entity_id),
    payload_json: str(r.payload_json),
    created_at: str(r.created_at) ?? '',
    acknowledged_at: str(r.acknowledged_at)
  };
}
