/**
 * Каркас ingestion (полный pipeline DISCOVER→…→INDEX — Этап 3).
 * Здесь: базовые типы задач и результатов доступа к источнику.
 */

export type JobStatus =
  | 'ok'
  | 'error'
  | 'skipped'
  | 'network_unavailable'
  | 'http_error'
  | 'timeout';

export interface JobRunRecord {
  run_id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  detail: string | null;
}

export interface JobDefinition {
  name: string;
  /** Интервал запуска, мс. */
  intervalMs: number;
  /** Исполнение задачи. Возвращает статус и текстовую сводку. */
  execute: () => Promise<{ status: JobStatus; detail?: string }>;
}

/** Сигнатура функции загрузки страницы (инжектится: live/fixture/тесты). */
export type FetchPageFn = (url: string, registeredUrl: string | null) => Promise<{
  outcome: 'ok' | 'http_error' | 'timeout' | 'network_unavailable' | 'redirect_blocked' | 'url_blocked' | 'too_large';
  httpStatus: number | null;
  body: string | null;
  mime: string | null;
  sizeBytes: number;
  durationMs: number;
  detail: string;
  finalUrl: string;
}>;

/** Результат проверки доступности источника. */
export interface AccessCheckResult {
  outcome: 'ok' | 'http_error' | 'timeout' | 'network_unavailable';
  httpStatus: number | null;
  detail: string;
}
