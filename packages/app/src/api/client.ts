import { z } from 'zod';
import { ResponseMeta } from '@yabloko/api-contract';

/**
 * API-клиент: относительные URL (транспорт решает прокси), ответы
 * валидируются контрактом (zod), включая конверт { data, meta }.
 * Нарушение контракта — ошибка, не тихий сбой.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  try {
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: res.ok };
  }
}

export async function fetchEnvelope<T>(
  url: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiError(`API ${url} ответил ${res.status}`, res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`API ${url}: некорректный JSON`);
  }
  const envelopeSchema = z.object({ data: schema, meta: ResponseMeta });
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      `API ${url}: ответ нарушает контракт (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`
    );
  }
  return parsed.data.data;
}

/**
 * POST с валидацией конверта { data, meta } — для ANALYST AI (ask/verify).
 * Нарушение контракта — ошибка, не тихий сбой.
 */
export async function postEnvelope<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`API ${url} ответил ${res.status}`, res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`API ${url}: некорректный JSON`);
  }
  if (json !== null && typeof json === 'object' && 'error' in (json as Record<string, unknown>)) {
    throw new ApiError(String((json as { error: unknown }).error));
  }
  const envelopeSchema = z.object({ data: schema, meta: ResponseMeta });
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      `API ${url}: ответ нарушает контракт (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`
    );
  }
  return parsed.data.data;
}
