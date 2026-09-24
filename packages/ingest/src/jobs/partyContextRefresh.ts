import type { Db } from '@yabloko/data-access';
import { checkSourceAccess } from '../access.js';
import type { JobDefinition } from '../types.js';

/**
 * Задача автоматического обновления Party Context.
 *
 * Этап 2: проверка доступности официального источника (yabloko.ru) и запись
 * результата в журнал. Этап 3 расширит её до полного pipeline
 * DISCOVER → FETCH → VERIFY → PARSE → CLASSIFY → EXTRACT POSITION → VERSION →
 * STORE → INDEX.
 *
 * В среде разработки без доступа к официальным источникам задача честно
 * фиксирует network_unavailable (это не ошибка данных, а состояние среды).
 */
export function createPartyContextRefreshJob(
  db: Db,
  options: { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): JobDefinition {
  const url = options.url ?? 'https://yabloko.ru';
  const row = db
    .prepare(`SELECT source_id FROM sources WHERE source_id = 'yabloko-ru'`)
    .get() as { source_id: string } | undefined;
  const checkUrl = row ? url : url;

  return {
    name: 'party-context-refresh',
    intervalMs: 15 * 60 * 1000,
    execute: async () => {
      const result = await checkSourceAccess(checkUrl, {
        timeoutMs: options.timeoutMs ?? 8000,
        fetchImpl: options.fetchImpl
      });

      if (result.outcome === 'ok') {
        return {
          status: 'ok',
          detail: `Источник доступен (${result.detail}). Полная верификация контекста — с Этапа 3.`
        };
      }
      if (result.outcome === 'http_error') {
        return {
          status: 'http_error',
          detail: `Источник ответил ошибкой: ${result.detail}`
        };
      }
      return {
        status: result.outcome === 'timeout' ? 'timeout' : 'network_unavailable',
        detail: result.detail
      };
    }
  };
}
