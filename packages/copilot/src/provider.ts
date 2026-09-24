/**
 * Provider abstraction (ARCHITECTURE §7.8): openai-compatible / anthropic /
 * локальный режим. Архитектура не привязана к вендору; без ключа провайдера —
 * graceful degraded mode (локальный детерминированный композер поверх
 * read-only инструментов, ответы строго из данных базы).
 */

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface LlmProvider {
  id: string;
  label: string;
  kind: 'openai-compatible' | 'anthropic';
  available(): boolean;
  complete(req: LlmRequest): Promise<string>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiCompatibleProvider(cfg: OpenAiCompatibleConfig): LlmProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    id: 'openai-compatible',
    label: `OpenAI-compatible (${cfg.model})`,
    kind: 'openai-compatible',
    available: () => cfg.apiKey.length > 0,
    async complete(req: LlmRequest): Promise<string> {
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: req.maxTokens ?? 1200,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user }
          ]
        })
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = String(json.choices?.[0]?.message?.content ?? '');
      if (!text) throw new Error('LLM: пустой ответ');
      return text;
    }
  };
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createAnthropicProvider(cfg: AnthropicConfig): LlmProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    id: 'anthropic',
    label: `Anthropic (${cfg.model})`,
    kind: 'anthropic',
    available: () => cfg.apiKey.length > 0,
    async complete(req: LlmRequest): Promise<string> {
      const res = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: req.maxTokens ?? 1200,
          temperature: 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }]
        })
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const json = (await res.json()) as { content?: Array<{ text?: unknown }> };
      const text = String(json.content?.[0]?.text ?? '');
      if (!text) throw new Error('LLM: пустой ответ');
      return text;
    }
  };
}

/** Локальный режим всегда доступен как последний рубеж (degraded mode). */
export const LOCAL_PROVIDER_ID = 'local-deterministic';
export const LOCAL_PROVIDER_LABEL = 'Локальный детерминированный режим (без LLM)';
