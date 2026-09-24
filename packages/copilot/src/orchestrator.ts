/**
 * Оркестратор YABLOKO ANALYST AI (Этап 13).
 *
 * Поток: вопрос → санитайз → детекция инъекций → интент → read-only
 * инструменты → ответ. Два режима:
 *  - LLM (если задан ключ провайдера): системный промпт статичен, данные
 *    передаются в сегменте <external_data>; выход валидируется схемой,
 *    при любом сбое — откат в локальный режим;
 *  - локальный детерминированный (graceful degraded mode): ответ собирается
 *    ТОЛЬКО из фактов инструментов — числа не изобретаются, источники
 *    только из реестра.
 * SOURCES всегда из базы; UNCERTAINTY всегда непустой.
 */

import type { Db } from '@yabloko/data-access';
import { listSources } from '@yabloko/data-access';
import { z } from 'zod';
import type { ScenarioTemplateInfo } from '@yabloko/api-contract';
import type {
  AnalystAnswerT as AnalystAnswer,
  AnalystBlockT as AnalystBlock,
  AnalystProviderInfoT as AnalystProviderInfo,
  AnalystSourceRefT as AnalystSourceRef,
  VerifySourceItemT as VerifySourceItem,
  VerifySourcesReportT as VerifySourcesReport
} from '@yabloko/api-contract';
import {
  SYSTEM_PROMPT,
  detectInjectionPatterns,
  sanitizeUserQuestion,
  wrapExternalContent
} from './sanitize.js';
import {
  LOCAL_PROVIDER_ID,
  createAnthropicProvider,
  createOpenAiCompatibleProvider
} from './provider.js';
import type { LlmProvider } from './provider.js';
import {
  detectIntent,
  runCompare,
  runNewDocuments,
  runResearch,
  runShowSources,
  runSimulate,
  runTopicsGrowth,
  runWhatChanged
} from './tools.js';
import type { Fact, Intent, ToolResult } from './tools.js';

export interface AnalystLlmConfig {
  provider: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface AskOptions {
  llm?: AnalystLlmConfig;
  mediaMethodology?: string;
  scenarioTemplates?: ScenarioTemplateInfo[];
}

const LlmAnswerSchema = z.object({
  answer: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  uncertainty: z.array(z.string()).default([])
});

const BLOCK_CATEGORY_LABEL: Record<AnalystBlock['category'], string> = {
  FACT: 'FACT',
  PARTY_STATEMENT: 'OFFICIAL PARTY STATEMENT',
  ANALYSIS: 'ANALYSIS',
  MODEL: 'MODEL'
};

function composeLocalBlocks(intent: Intent, tool: ToolResult): AnalystBlock[] {
  const fact = (i: number) => tool.facts[i];
  const f0 = fact(0);
  const f1 = fact(1);
  const f2 = fact(2);
  let text: string;
  switch (intent) {
    case 'compare':
      text =
        `${tool.title}. ` +
        (f0 && f1 && f2
          ? `Выше всех: ${f0.label.replace(/^Выше: /, '')} — ${f0.value_text}; ${f1.label.replace(/^Выше: /, '')} — ${f1.value_text}; ниже всех: ${f2.label.replace(/^Ниже: /, '')} — ${f2.value_text}. `
          : 'Данных для сравнения недостаточно (INSUFFICIENT DATA). ') +
        (tool.caveats[0] ?? '');
      break;
    case 'what_changed':
      text =
        `${tool.title}. ` +
        (f0
          ? tool.facts
              .slice(0, 5)
              .map((x) => `${x.label}: ${x.value_text}`)
              .join('; ') + '. '
          : 'Данных о динамике нет (INSUFFICIENT DATA). ') +
        (tool.caveats[0] ?? '');
      break;
    case 'topics_growth':
      text =
        `${tool.title}. ` +
        (f0
          ? tool.facts.map((x) => `${x.label} — ${x.value_text}`).join('; ') + '. '
          : 'Тем в корпусе нет (INSUFFICIENT DATA). ') +
        (tool.caveats[1] ?? tool.caveats[0] ?? '');
      break;
    case 'show_sources':
      text =
        `${tool.title}. ` +
        (f0
          ? `Примеры: ${tool.facts.slice(0, 4).map((x) => `${x.label} (${x.value_text})`).join('; ')}. `
          : '') +
        (tool.caveats[0] ?? '');
      break;
    case 'new_documents':
      text =
        `${tool.title}. ` +
        (f0
          ? tool.facts.map((x) => `«${x.label}» — ${x.value_text}`).join('; ') + '. '
          : 'Новых документов нет (INSUFFICIENT DATA). ') +
        ' Все позиции партии — только из реестра (OFFICIAL PARTY STATEMENT); AI позиции не формулировал.';
      break;
    case 'research':
      text =
        `${tool.title}. ` +
        (f0
          ? `Найдено: ${tool.facts.map((x) => `«${x.label}»`).join(', ')}. Полные тексты — в документах платформы. `
          : 'Совпадений нет — выдумывать источники запрещено. ') +
        (tool.caveats[0] ?? '');
      break;
    case 'simulate':
      text =
        `${tool.title}. ` +
        (f0
          ? tool.facts.map((x) => `${x.label} — ${x.value_text}`).join('; ') + '. '
          : 'Шаблонов сценариев нет (INSUFFICIENT DATA). ') +
        ' При предположениях модель оценивает диапазон p10…p90; расчёт — в разделе DECISION LAB. ' +
        (tool.caveats[1] ?? tool.caveats[0] ?? '');
      break;
    default:
      text =
        'Запрос не распознан точно — показана сводка. Доступные типы запросов: «сравни регионы», ' +
        '«что изменилось», «какие темы выросли», «покажи источники», «новые документы», ' +
        '«исследование по X», «смоделируй сценарий». ' +
        (f0 ? `${tool.title}: ${f0.label} — ${f0.value_text}.` : '');
  }
  const blocks: AnalystBlock[] = [{ category: 'ANALYSIS', text }];
  // Категорийные блоки: партийные и модельные факты — отдельными блоками (несмешение).
  const party = tool.facts.filter((x) => x.category === 'PARTY_STATEMENT');
  if (party.length > 0) {
    blocks.push({
      category: 'PARTY_STATEMENT',
      text: party.map((x) => `${x.label} — ${x.value_text}`).join('; ')
    });
  }
  const model = tool.facts.filter((x) => x.category === 'MODEL');
  if (model.length > 0) {
    blocks.push({
      category: 'MODEL',
      text: model.map((x) => `${x.label} — ${x.value_text}`).join('; ')
    });
  }
  return blocks;
}

function standardUncertainty(intent: Intent, providerMode: 'llm' | 'local-degraded'): string[] {
  const base = [
    'Данные платформы — SYNTHETIC (grade D): демонстрационные значения, не официальная статистика.',
    'Корреляция не причинность; сравнения территорий — констатация по датасету.'
  ];
  if (intent === 'topics_growth') {
    base.push('Доли контекста — констатация по корпусу с методологией; sentiment-ярлык без сноски запрещён.');
  }
  if (intent === 'simulate') {
    base.push('Модельные оценки — только «при предположениях… модель оценивает диапазон»; не прогноз и не рекомендация.');
  }
  if (providerMode === 'llm') {
    base.push('Ответ сгенерирован LLM поверх извлечённых данных и валидирован схемой; цифры и источники — только из DATA/SOURCES.');
  } else {
    base.push('Локальный режим: ответ собран детерминированно из фактов инструментов, без генерации.');
  }
  return base;
}

function buildSources(db: Db, facts: Fact[]): AnalystSourceRef[] {
  const registry = new Map(listSources(db).map((s) => [s.source_id, s]));
  const seen = new Set<string>();
  const out: AnalystSourceRef[] = [];
  for (const f of facts) {
    if (seen.has(f.source_id)) continue;
    seen.add(f.source_id);
    const src = registry.get(f.source_id);
    out.push({
      source_id: f.source_id,
      name: src?.name ?? f.source_name ?? null,
      status: src?.status ?? null,
      grade: src?.reliability.grade ?? null,
      url_present: Boolean(src?.url),
      checksum_present: Boolean(src?.checksum)
    });
  }
  return out;
}

function buildLlmUserContent(question: string, tool: ToolResult, sources: AnalystSourceRef[]): string {
  const parts: string[] = [];
  parts.push('DATA (факты инструментов — единственный источник чисел):');
  parts.push(JSON.stringify({ title: tool.title, facts: tool.facts, caveats: tool.caveats }, null, 1));
  for (const ext of tool.external) {
    parts.push(wrapExternalContent(ext.label, ext.text));
  }
  parts.push(`SOURCES (источники ответа — только эти): ${JSON.stringify(sources)}`);
  parts.push(`ВОПРОС АНАЛИТИКА: ${question}`);
  return parts.join('\n\n');
}

function parseLlmJson(raw: string): z.infer<typeof LlmAnswerSchema> | null {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?/i, (m) => (m.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/i, '')
    .trim();
  const candidate = cleaned.startsWith('{') ? cleaned : raw.trim();
  try {
    const parsed = LlmAnswerSchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function askAnalyst(
  db: Db,
  questionRaw: string,
  opts: AskOptions = {}
): Promise<AnalystAnswer> {
  const question = sanitizeUserQuestion(questionRaw);
  const questionHits = detectInjectionPatterns(question);
  const intent = detectIntent(question);
  const mediaMethodology = opts.mediaMethodology ?? '';

  let tool: ToolResult;
  switch (intent) {
    case 'compare':
      tool = runCompare(db, question);
      break;
    case 'what_changed':
      tool = runWhatChanged(db);
      break;
    case 'topics_growth':
      tool = runTopicsGrowth(db, mediaMethodology);
      break;
    case 'show_sources':
      tool = runShowSources(db, question);
      break;
    case 'new_documents':
      tool = runNewDocuments(db);
      break;
    case 'research':
      tool = runResearch(db, question);
      break;
    case 'simulate':
      tool = runSimulate(db, opts.scenarioTemplates ?? []);
      break;
    default:
      tool = runWhatChanged(db);
  }

  // Инъекции в retrieved-контенте (титулы, сниппеты, summaries) — детектируются, не исполняются.
  const contentText = [tool.title, ...tool.facts.map((f) => `${f.label} ${f.value_text}`), ...tool.external.map((e) => e.text)].join('\n');
  const contentHits = detectInjectionPatterns(contentText);
  const seenPatterns = new Set<string>();
  const injections = [...questionHits, ...contentHits].filter((h) => {
    if (seenPatterns.has(h.pattern_id)) return false;
    seenPatterns.add(h.pattern_id);
    return true;
  });

  const sources = buildSources(db, tool.facts);
  const blocks = composeLocalBlocks(intent, tool);
  let providerId = LOCAL_PROVIDER_ID;
  let providerMode: 'llm' | 'local-degraded' = 'local-degraded';

  const cfg = opts.llm;
  if (cfg && cfg.apiKey) {
    let provider: LlmProvider | null = null;
    try {
      provider =
        cfg.provider === 'anthropic'
          ? createAnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model, fetchImpl: cfg.fetchImpl })
          : createOpenAiCompatibleProvider({
              baseUrl: cfg.baseUrl ?? 'https://api.openai.com/v1',
              apiKey: cfg.apiKey,
              model: cfg.model,
              fetchImpl: cfg.fetchImpl
            });
      const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        user: buildLlmUserContent(question, tool, sources),
        maxTokens: 1200
      });
      const parsed = parseLlmJson(raw);
      if (parsed) {
        providerId = provider.id;
        providerMode = 'llm';
        blocks.unshift({ category: 'ANALYSIS', text: parsed.answer });
      }
    } catch {
      provider = null;
    }
    void provider;
  }

  return {
    question,
    intent,
    provider_id: providerId,
    provider_mode: providerMode,
    blocks,
    evidence: tool.facts.map((f) => ({
      label: f.label,
      value_text: f.value_text,
      category: f.category,
      source_id: f.source_id,
      source_name: f.source_name
    })),
    sources,
    uncertainty: standardUncertainty(intent, providerMode),
    tools_used: [tool.tool],
    injections_detected: injections
  };
}

/** VERIFY SOURCES: пере-проверка источников ответа по реестру (URL, checksum, статус). */
export function verifySources(db: Db, sourceIds: string[]): VerifySourcesReport {
  const ids = sourceIds.map((s) => String(s).slice(0, 120)).filter((s) => s.length > 0).slice(0, 50);
  const items: VerifySourceItem[] = [];
  let withUrl = 0;
  let withChecksum = 0;
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT s.source_id, s.name, s.url, s.checksum, s.status, s.last_update, s.reliability_metadata
         FROM sources s WHERE s.source_id = ?`
      )
      .get(id) as
      | { source_id: string; name: string; url: string | null; checksum: string | null; status: string; last_update: string | null; reliability_metadata: string | null }
      | undefined;
    if (!row) {
      items.push({
        source_id: id,
        found: false,
        name: null,
        checks: [{ check: 'REGISTRY', result: 'NOT_FOUND', detail: 'Источника нет в Source Registry.' }]
      });
      continue;
    }
    let grade: string | null = null;
    try {
      const meta = row.reliability_metadata ? (JSON.parse(row.reliability_metadata) as { grade?: unknown }) : null;
      grade = meta && typeof meta.grade === 'string' ? meta.grade : null;
    } catch {
      grade = null;
    }
    const checks: VerifySourceItem['checks'] = [
      { check: 'REGISTRY', result: 'FOUND', detail: `статус ${row.status}${grade ? `, grade ${grade}` : ''}` },
      row.url
        ? { check: 'URL', result: 'PRESENT', detail: row.url }
        : { check: 'URL', result: 'ABSENT', detail: 'SYNTHETIC-источник без URL — пере-проверка невозможна.' },
      row.checksum
        ? { check: 'CHECKSUM', result: 'PRESENT', detail: `checksum ${String(row.checksum).slice(0, 16)}…` }
        : { check: 'CHECKSUM', result: 'ABSENT', detail: 'Контрольная сумма не зафиксирована (fixture-режим).' },
      row.last_update
        ? { check: 'LAST_UPDATE', result: 'PRESENT', detail: row.last_update }
        : { check: 'LAST_UPDATE', result: 'INSUFFICIENT_DATA', detail: 'Дата последнего обновления неизвестна.' }
    ];
    if (row.url) withUrl += 1;
    if (row.checksum) withChecksum += 1;
    items.push({ source_id: id, found: true, name: row.name, checks });
  }
  const found = items.filter((i) => i.found).length;
  return {
    items,
    summary: { total: items.length, found, with_url: withUrl, with_checksum: withChecksum },
    note:
      'VERIFY SOURCES сверяет источники с Source Registry (наличие, URL, checksum, статус). ' +
      'В fixture/SYNTHETIC-режиме URL и checksum в основном отсутствуют — это честно отражается в отчёте, а не маскируется.'
  };
}

/** Статус провайдеров (Settings): без ключа — degraded mode. */
export function analystStatus(llm?: AnalystLlmConfig): {
  active_provider: string;
  degraded_mode: boolean;
  degraded_reason: string;
  providers: AnalystProviderInfo[];
} {
  const providers: AnalystProviderInfo[] = [
    {
      id: 'openai-compatible',
      label: 'OpenAI-compatible',
      kind: 'openai-compatible',
      configured: llm?.provider === 'openai-compatible' && Boolean(llm.apiKey),
      available: llm?.provider === 'openai-compatible' && Boolean(llm.apiKey),
      note: 'Задаётся env ANALYST_LLM_PROVIDER=openai-compatible + ANALYST_LLM_API_KEY/ANALYST_LLM_BASE_URL/ANALYST_LLM_MODEL.'
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      kind: 'anthropic',
      configured: llm?.provider === 'anthropic' && Boolean(llm.apiKey),
      available: llm?.provider === 'anthropic' && Boolean(llm.apiKey),
      note: 'Задаётся env ANALYST_LLM_PROVIDER=anthropic + ANALYST_LLM_API_KEY/ANALYST_LLM_MODEL.'
    },
    {
      id: LOCAL_PROVIDER_ID,
      label: 'Локальный детерминированный режим',
      kind: 'local',
      configured: true,
      available: true,
      note: 'Ответы собираются из фактов read-only инструментов; числа не генерируются.'
    }
  ];
  const active = llm?.apiKey
    ? llm.provider
    : LOCAL_PROVIDER_ID;
  const degraded = active === LOCAL_PROVIDER_ID;
  return {
    active_provider: active,
    degraded_mode: degraded,
    degraded_reason: degraded
      ? 'Ключ LLM-провайдера не настроен. Работает локальный детерминированный режим: ответы собираются из данных базы через read-only инструменты, числа и источники не генерируются. Качество анализа ограничено — это честный degraded mode.'
      : 'LLM-провайдер активен; выход валидируется схемой, при сбое — автоматический откат в локальный режим.',
    providers
  };
}

export { BLOCK_CATEGORY_LABEL };
