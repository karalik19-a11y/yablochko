import { createHash, randomUUID } from 'node:crypto';

/**
 * HTTP-слой ingestion: fetch с retry (экспоненциальная пауза) и SSRF-защитой.
 *
 * Безопасность (docs/ARCHITECTURE.md §9.2):
 *  - только http/https;
 *  - хост каждого редиректа сверяется с allowlist (redirect: 'manual',
 *    переходы выполняем сами);
 *  - лимит размера тела и таймаут на попытку;
 *  - учётные данные в URL запрещены.
 */

export const USER_AGENT = 'YablokoIntelligence/0.3 (+source-verification; internal)';

export interface FetchOutcome {
  outcome: 'ok' | 'http_error' | 'timeout' | 'network_unavailable' | 'redirect_blocked' | 'url_blocked' | 'too_large';
  httpStatus: number | null;
  body: string | null;
  mime: string | null;
  sizeBytes: number;
  durationMs: number;
  detail: string;
  finalUrl: string;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface UrlGuard {
  ok: boolean;
  reason?: string;
}

/**
 * SSRF-защита: URL должен быть http(s), без учётных данных, и его хост —
 * совпадать с зарегистрированным хостом источника (или его поддоменом).
 */
export function checkUrlAllowed(rawUrl: string, registeredUrl: string | null): UrlGuard {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Некорректный URL' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: `Схема запрещена: ${u.protocol}` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: 'Учётные данные в URL запрещены' };
  }
  if (!registeredUrl) {
    return { ok: false, reason: 'У источника не зарегистрирован URL' };
  }
  let reg: URL;
  try {
    reg = new URL(registeredUrl);
  } catch {
    return { ok: false, reason: 'Некорректный registered URL источника' };
  }
  const host = u.hostname.toLowerCase();
  const allowed = reg.hostname.toLowerCase();
  if (host !== allowed && !host.endsWith(`.${allowed}`)) {
    return { ok: false, reason: `Хост ${host} вне allowlist источника (${allowed})` };
  }
  return { ok: true };
}

export interface FetchPageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  attempts?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  /** Пауза между попытками (инжектится в тестах). */
  sleep?: (ms: number) => Promise<void>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchOnce(
  url: string,
  opts: Required<Pick<FetchPageOptions, 'timeoutMs' | 'maxBytes' | 'maxRedirects'>> & {
    fetchImpl: typeof fetch;
    registeredHost: string | null;
  }
): Promise<FetchOutcome> {
  const started = Date.now();
  let current = url;
  let redirects = 0;

  for (;;) {
    // SSRF-проверка на каждом переходе (включая редиректы).
    const guard = checkUrlAllowed(current, opts.registeredHost ? `https://${opts.registeredHost}` : null);
    if (!guard.ok) {
      return {
        outcome: redirects > 0 ? 'redirect_blocked' : 'url_blocked',
        httpStatus: null,
        body: null,
        mime: null,
        sizeBytes: 0,
        durationMs: Date.now() - started,
        detail: guard.reason ?? 'URL отклонён',
        finalUrl: current
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await opts.fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === 'AbortError';
      return {
        outcome: aborted ? 'timeout' : 'network_unavailable',
        httpStatus: null,
        body: null,
        mime: null,
        sizeBytes: 0,
        durationMs: Date.now() - started,
        detail: aborted ? `Таймаут ${opts.timeoutMs} мс` : `Сеть недоступна: ${e instanceof Error ? e.message : String(e)}`,
        finalUrl: current
      };
    }
    clearTimeout(timer);

    // Редиректы ведём вручную с проверкой каждого хопа.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return {
          outcome: 'http_error',
          httpStatus: res.status,
          body: null,
          mime: null,
          sizeBytes: 0,
          durationMs: Date.now() - started,
          detail: `Редирект ${res.status} без Location`,
          finalUrl: current
        };
      }
      if (redirects >= opts.maxRedirects) {
        return {
          outcome: 'http_error',
          httpStatus: res.status,
          body: null,
          mime: null,
          sizeBytes: 0,
          durationMs: Date.now() - started,
          detail: `Превышен лимит редиректов (${opts.maxRedirects})`,
          finalUrl: current
        };
      }
      redirects += 1;
      current = new URL(loc, current).toString();
      continue;
    }

    if (!res.ok) {
      return {
        outcome: 'http_error',
        httpStatus: res.status,
        body: null,
        mime: res.headers.get('content-type'),
        sizeBytes: 0,
        durationMs: Date.now() - started,
        detail: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
        finalUrl: current
      };
    }

    const mime = res.headers.get('content-type');
    const lenHeader = Number(res.headers.get('content-length') ?? '0');
    if (lenHeader > opts.maxBytes) {
      return {
        outcome: 'too_large',
        httpStatus: res.status,
        body: null,
        mime,
        sizeBytes: lenHeader,
        durationMs: Date.now() - started,
        detail: `Размер ${lenHeader} > лимита ${opts.maxBytes}`,
        finalUrl: current
      };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > opts.maxBytes) {
      return {
        outcome: 'too_large',
        httpStatus: res.status,
        body: null,
        mime,
        sizeBytes: buf.byteLength,
        durationMs: Date.now() - started,
        detail: `Размер ${buf.byteLength} > лимита ${opts.maxBytes}`,
        finalUrl: current
      };
    }
    return {
      outcome: 'ok',
      httpStatus: res.status,
      body: new TextDecoder('utf-8', { fatal: false }).decode(buf),
      mime,
      sizeBytes: buf.byteLength,
      durationMs: Date.now() - started,
      detail: `HTTP ${res.status}`,
      finalUrl: current
    };
  }
}

/**
 * GET с retry: экспоненциальная пауза ± jitter. Повторяем сеть/таймаут/5xx/429;
 * блокировки URL и превышение размера не повторяем.
 */
export async function fetchPage(
  url: string,
  registeredUrl: string | null,
  options: FetchPageOptions = {}
): Promise<FetchOutcome> {
  const {
    timeoutMs = 10_000,
    maxBytes = 2_000_000,
    maxRedirects = 3,
    attempts = 3,
    backoffBaseMs = 150,
    fetchImpl = fetch,
    sleep = sleepDefault
  } = options;

  const registeredHost = registeredUrl ? safeHost(registeredUrl) : null;
  let last: FetchOutcome | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await fetchOnce(url, {
      timeoutMs,
      maxBytes,
      maxRedirects,
      fetchImpl,
      registeredHost
    });
    last = result;
    const retryable =
      result.outcome === 'network_unavailable' ||
      result.outcome === 'timeout' ||
      (result.httpStatus !== null && (result.httpStatus >= 500 || result.httpStatus === 429));
    if (!retryable || attempt === attempts) break;
    const jitter = Math.round(Math.random() * backoffBaseMs * 0.3);
    await sleep(backoffBaseMs * Math.pow(2, attempt - 1) + jitter);
  }
  return last as FetchOutcome;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Короткий идентификатор для run/snapshot/alert. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
