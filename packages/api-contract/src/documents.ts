import { z } from 'zod';
import { IsoDateTime } from './common.js';

/**
 * Документы источников (результат ingestion pipeline). Каждый документ несёт
 * полный provenance: источник, URL, snapshot (http_status), checksum.
 */
export const SourceDocument = z.object({
  doc_id: z.string(),
  source_id: z.string(),
  source_name: z.string().nullable(),
  url: z.string(),
  title: z.string().nullable(),
  doc_kind: z.string().nullable(),
  published_at: z.string().nullable(),
  fetched_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  content_hash: z.string().nullable(),
  version: z.number().int(),
  status: z.string(),
  size_bytes: z.number().int().nullable(),
  http_status: z.number().int().nullable(),
  fetch_mode: z.string().nullable()
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const DocumentsPage = z.object({
  items: z.array(SourceDocument),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int()
});
export type DocumentsPage = z.infer<typeof DocumentsPage>;

export const FtsHit = z.object({
  doc_id: z.string(),
  title: z.string().nullable(),
  snippet: z.string().nullable()
});
export type FtsHit = z.infer<typeof FtsHit>;

/** Ответ поиска по документам (FTS). */
export const DocumentSearch = z.object({
  query: z.string(),
  hits: z.array(FtsHit)
});
export type DocumentSearch = z.infer<typeof DocumentSearch>;

/** Информационный запуск ingestion (для экрана источников). */
export const IngestionRunInfo = z.object({
  status: z.string(),
  started_at: IsoDateTime,
  finished_at: z.string().nullable(),
  mode: z.string(),
  detail: z.string().nullable()
});
export type IngestionRunInfo = z.infer<typeof IngestionRunInfo>;
