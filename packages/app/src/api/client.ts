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
