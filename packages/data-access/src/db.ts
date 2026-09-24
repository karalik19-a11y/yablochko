import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/**
 * Открывает SQLite-соединение (embedded-профиль, ADR-0006).
 * Включает WAL и внешние ключи.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

/** Строки node:sqlite имеют null-прототип — приводим к обычным объектам. */
export function plainRows(rows: readonly unknown[]): Record<string, unknown>[] {
  return rows.map((r) => ({ ...(r as object) }));
}
