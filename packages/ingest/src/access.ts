import type { AccessCheckResult } from './types.js';

const USER_AGENT =
  'YablokoIntelligence/0.2 (+source-verification; contact: internal)';

/**
 * Проверка доступности источника (первый шаг VERIFY будущего pipeline).
 * Никогда не бросает исключений — ошибки сети классифицируются.
 * fetchImpl внедряется для тестов (никаких реальных сетевых вызовов в тестах).
 */
export async function checkSourceAccess(
  url: string,
  options: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    method?: 'GET' | 'HEAD';
  } = {}
): Promise<AccessCheckResult> {
  const { timeoutMs = 8000, fetchImpl = fetch, method = 'GET' } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT }
    });
    return {
      outcome: res.ok ? 'ok' : 'http_error',
      httpStatus: res.status,
      detail: `HTTP ${res.status} ${res.statusText || ''}`.trim()
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { outcome: 'timeout', httpStatus: null, detail: `Таймаут ${timeoutMs} мс` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      outcome: 'network_unavailable',
      httpStatus: null,
      detail: `Сеть недоступна: ${msg}`
    };
  } finally {
    clearTimeout(timer);
  }
}
