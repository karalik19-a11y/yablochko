import { useCallback, useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { fetchEnvelope } from './client.js';

export interface ApiState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  reload: () => void;
}

interface Stored<T> {
  attempt: number;
  status: 'ready' | 'error' | 'loading';
  data: T | null;
  error: string | null;
}

/**
 * Загрузка + валидация контракта + состояния loading/error для UI.
 * Loading — производное состояние: результат предыдущего запроса считается
 * устаревшим при смене url/attempt. setState вызывается только асинхронно.
 */
export function useApi<T>(url: string, schema: ZodType<T>): ApiState<T> {
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<Stored<T>>({
    attempt,
    status: 'loading',
    data: null,
    error: null
  });

  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetchEnvelope(url, schema, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setStored({ attempt, status: 'ready', data, error: null });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Неизвестная ошибка запроса';
          setStored({ attempt, status: 'error', data: null, error: message });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, attempt, schema]);

  const isStale = stored.attempt !== attempt;
  return {
    status: isStale ? 'loading' : stored.status,
    data: isStale ? null : stored.data,
    error: isStale ? null : stored.error,
    reload
  };
}
