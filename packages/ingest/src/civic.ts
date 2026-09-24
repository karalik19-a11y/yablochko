/**
 * Civic Sentiment Engine — pipeline (чистые функции, без БД):
 *
 * RAW TEXT → LANGUAGE DETECTION → CLEANING → DEDUPLICATION → PII REDACTION →
 * TOPIC EXTRACTION → SENTIMENT → QUESTION STANCE → AGGREGATION
 *
 * Ключевое ограничение (архитектурное): результат содержит ТОЛЬКО агрегаты
 * и статистику. Сырые и отредактированные тексты наружу не отдаются
 * (см. pipeline.test.ts — стражи на отсутствие текстовых полей).
 * Персональные профили не создаются никогда.
 */

// ---------- Методология: лексикон ----------

/** Позитивные стемы (сопоставление: token.startsWith(lexeme)). */
export const POSITIVE_LEXICON = [
  'хорош', 'отличн', 'прекрасн', 'спасибо', 'благодар', 'рад', 'нравится',
  'улучши', 'лучше', 'успешн', 'успех', 'вырос', 'восстанов', 'открыли',
  'отремонтир', 'помог', 'помогла', 'помогли', 'вылечили', 'решён', 'решен',
  'качествен', 'доволен', 'довольна', 'приятно', 'прогресс', 'надеюсь',
  'верю', 'поддержив', 'согласен', 'согласна', 'молодцы', 'эффективн',
  'выгодно', 'удобно', 'порадовал', 'позитив', 'оптимист', 'подешевел',
  'поздравля', 'получилось', 'справились', 'запустили', 'работает'
];

export const NEGATIVE_LEXICON = [
  'плох', 'ужасн', 'ужас', 'кошмар', 'беда', 'проблем', 'жалоб', 'возмут',
  'коррупц', 'воровств', 'обман', 'разруш', 'развалив', 'яма', 'разбит',
  'грязь', 'мусор', 'холодно', 'гололёд', 'гололед', 'пробк', 'затор',
  'авари', 'бардак', 'бездейств', 'хамств', 'грубость', 'очеред', 'сломан',
  'дорого', 'невозможно', 'критичн', 'кризис', 'сократил', 'уволил',
  'задержива', 'разруха', 'износ', 'ветх', 'аварийн', 'отключ', 'перебой',
  'срыв', 'свалк', 'ущерб', 'подорожал', 'подорожан', 'повысил', 'дефицит',
  'нехватк', 'пыль', 'вонь', 'переполн', 'игнорир', 'фальсифик', 'нарушен',
  'враньё', 'вранье', 'ложь', 'страх', 'тревог', 'устал', 'недоволен',
  'недовольн', 'возмущен', 'упал', 'ухудш'
];

export const NEGATION_WORDS = ['не', 'нет', 'ни', 'никогда', 'без', 'отсутств'];

export const QUESTION_WORDS = [
  'как', 'что', 'почему', 'когда', 'где', 'сколько', 'кто', 'зачем',
  'какой', 'какая', 'будет', 'можно', 'скажите'
];

export type SentimentClass = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unclear';

export const SENTIMENT_METHOD_REF =
  'civic-sentiment/lexicon-v1: детерминированный русский лексикон ' +
  `(${POSITIVE_LEXICON.length}+/­${NEGATIVE_LEXICON.length}- стемов), отрицание в окне 2 слова ` +
  'меняет знак сигнала; Mixed при одновременных сигналах с соотношением 1:3…3:1; ' +
  'Unclear при <3 слов или вопросе без sentiment-сигналов.';

export interface SentimentResult {
  sentiment: SentimentClass;
  posSignals: number;
  negSignals: number;
  isQuestion: boolean;
}

/** Классификация sentiment + вопросительная стойка (question stance). */
export function classifySentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  const tokens = (lower.match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
  const isQuestion = /\?/.test(text) || QUESTION_WORDS.includes(tokens[0] ?? '');

  if (tokens.length < 3) {
    return { sentiment: 'unclear', posSignals: 0, negSignals: 0, isQuestion };
  }

  let pos = 0;
  let neg = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as string;
    let sign = 0;
    if (POSITIVE_LEXICON.some((l) => tok.startsWith(l))) sign = 1;
    else if (NEGATIVE_LEXICON.some((l) => tok.startsWith(l))) sign = -1;
    if (sign === 0) continue;
    // Отрицание в окне 2 предыдущих слов меняет знак.
    const prev1 = tokens[i - 1];
    const prev2 = tokens[i - 2];
    const negated =
      (prev1 !== undefined && NEGATION_WORDS.includes(prev1)) ||
      (prev2 !== undefined && NEGATION_WORDS.includes(prev2));
    if (negated) sign = -sign;
    if (sign > 0) pos += 1;
    else neg += 1;
  }

  let sentiment: SentimentClass;
  if (pos > 0 && neg > 0) {
    const ratio = pos / neg;
    sentiment = ratio >= 1 / 3 && ratio <= 3 ? 'mixed' : pos > neg ? 'positive' : 'negative';
  } else if (pos > 0) sentiment = 'positive';
  else if (neg > 0) sentiment = 'negative';
  else sentiment = isQuestion ? 'unclear' : 'neutral';

  return { sentiment, posSignals: pos, negSignals: neg, isQuestion };
}

// ---------- PII Redaction ----------

export interface PiiPattern {
  kind: string;
  regex: RegExp;
  replacement: string;
}

export const PII_PATTERNS: PiiPattern[] = [
  { kind: 'phone', regex: /(?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2}/g, replacement: '[REDACTED:PHONE]' },
  { kind: 'email', regex: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, replacement: '[REDACTED:EMAIL]' },
  { kind: 'passport', regex: /\b\d{4}\s\d{6}\b/g, replacement: '[REDACTED:PASSPORT]' },
  { kind: 'card', regex: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[REDACTED:CARD]' },
  { kind: 'snils', regex: /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/g, replacement: '[REDACTED:SNILS]' },
  { kind: 'name_patronymic', regex: /(?<![А-Яа-яЁёA-Za-z])[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(ович|евич|овна|евна|ична|инична)(?![А-Яа-яЁёA-Za-z])/g, replacement: '[REDACTED:NAME]' },
  { kind: 'address', regex: /(?<![А-Яа-яЁёA-Za-z])(?:ул|улица|пр-т|проспект|ш)\.?\s[^,.;]{1,30}(?:д\.\s?\d+|\d+)?/gi, replacement: '[REDACTED:ADDRESS]' },
  { kind: 'url', regex: /https?:\/\/\S+/g, replacement: '[REDACTED:URL]' }
];

export interface PiiRedactionResult {
  text: string;
  counts: Record<string, number>;
  total: number;
}

/** Редактирование PII в тексте. Каждое вхождение заменяется меткой. */
export function redactPii(text: string): PiiRedactionResult {
  let out = text;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const p of PII_PATTERNS) {
    out = out.replace(p.regex, () => {
      counts[p.kind] = (counts[p.kind] ?? 0) + 1;
      total += 1;
      return p.replacement;
    });
  }
  return { text: out, counts, total };
}

// ---------- Language / Cleaning / Dedup ----------

export type LanguageClass = 'ru' | 'other' | 'short';

/** LANGUAGE DETECTION: доля кириллицы среди букв ≥ 0.5 → 'ru'. */
export function detectLanguage(text: string): LanguageClass {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 5) return 'short';
  const cyr = text.match(/[\u0400-\u04FF]/gu) ?? [];
  return cyr.length / letters.length >= 0.5 ? 'ru' : 'other';
}

/** CLEANING: html-сущности, управляющие символы, схлопывание пробелов. */
export function cleanMessage(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    // eslint-disable-next-line no-control-regex -- назначение функции: удалить управляющие символы
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Нормализация для дедупликации: строчные буквы, только буквы/цифры. */
export function normalizeForDedup(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

export function dedupHash(normalized: string): string {
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0;
  return `d${h.toString(16)}`;
}

// ---------- Topics ----------

export interface TopicDef {
  topic_id: string;
  name: string;
  category: string | null;
  keywords: string[];
}

/** TOPIC EXTRACTION: multi-label, сопоставление стемов по вхождению. */
export function extractTopics(lowerText: string, topics: TopicDef[]): string[] {
  const matched: string[] = [];
  for (const t of topics) {
    if (t.keywords.some((kw) => lowerText.includes(kw.toLowerCase()))) {
      matched.push(t.topic_id);
    }
  }
  return matched;
}

// ---------- Pipeline ----------

export interface CivicMessageInput {
  text: string;
  /** ISO-дата сообщения (YYYY-MM-DD). */
  date: string;
  geo_id?: string;
}

export interface CivicAggregateRow {
  geo_id: string;
  topic_id: string;
  period: string;
  n_messages: number;
  n_positive: number;
  n_neutral: number;
  n_negative: number;
  n_mixed: number;
  n_unclear: number;
  n_questions: number;
}

export interface CivicPipelineStats {
  n_in: number;
  n_short_excluded: number;
  n_other_language: number;
  n_after_language: number;
  n_duplicates: number;
  n_after_dedup: number;
  n_no_geo: number;
  n_no_topic: number;
  pii_counts: Record<string, number>;
  pii_total: number;
  messages_by_topic: Record<string, number>;
  period_from: string | null;
  period_to: string | null;
}

export interface CivicPipelineResult {
  aggregates: CivicAggregateRow[];
  stats: CivicPipelineStats;
  /** Количество строк журнала PII по видам (для pii_log; без текстов). */
  pii_counts: Record<string, number>;
}

export interface CivicPipelineOptions {
  topics: TopicDef[];
  /** Гео по умолчанию для сообщений без индивидуального geo_id. */
  defaultGeoId?: string;
  /** Держать только русский язык (лексикон русский). По умолчанию true. */
  russianOnly?: boolean;
}

/**
 * Полный pipeline батча. Одинаковому нормализованному тексту — один учёт
 * (дедупликация внутри батча). Сообщения без темы/гео учитываются в stats,
 * но не попадают в агрегаты.
 */
export function runCivicPipeline(
  messages: CivicMessageInput[],
  opts: CivicPipelineOptions
): CivicPipelineResult {
  const stats: CivicPipelineStats = {
    n_in: messages.length,
    n_short_excluded: 0,
    n_other_language: 0,
    n_after_language: 0,
    n_duplicates: 0,
    n_after_dedup: 0,
    n_no_geo: 0,
    n_no_topic: 0,
    pii_counts: {},
    pii_total: 0,
    messages_by_topic: {},
    period_from: null,
    period_to: null
  };
  const russianOnly = opts.russianOnly ?? true;
  const piiCounts: Record<string, number> = {};

  const seen = new Set<string>();
  // (geo, topic, period) → counters
  const acc = new Map<string, { g: string; t: string; p: string; c: [number, number, number, number, number, number] }>();

  for (const msg of messages) {
    // LANGUAGE DETECTION + CLEANING
    const lang = detectLanguage(msg.text);
    if (lang === 'short') {
      stats.n_short_excluded += 1;
      continue;
    }
    if (russianOnly && lang === 'other') {
      stats.n_other_language += 1;
      continue;
    }
    stats.n_after_language += 1;
    const cleaned = cleanMessage(msg.text);

    // DEDUPLICATION
    const key = dedupHash(normalizeForDedup(cleaned));
    if (seen.has(key)) {
      stats.n_duplicates += 1;
      continue;
    }
    seen.add(key);
    stats.n_after_dedup += 1;

    // PII REDACTION (текст редактируется, но НЕ сохраняется)
    const pii = redactPii(cleaned);
    for (const [k, v] of Object.entries(pii.counts)) {
      piiCounts[k] = (piiCounts[k] ?? 0) + v;
      stats.pii_counts[k] = (stats.pii_counts[k] ?? 0) + v;
      stats.pii_total += v;
    }

    // TOPIC EXTRACTION
    const matched = extractTopics(pii.text.toLowerCase(), opts.topics);
    if (matched.length === 0) {
      stats.n_no_topic += 1;
      continue;
    }

    // GEO
    const geo = msg.geo_id ?? opts.defaultGeoId;
    if (!geo) {
      stats.n_no_geo += 1;
      continue;
    }
    const period = msg.date.slice(0, 7);
    if (!stats.period_from || period < stats.period_from) stats.period_from = period;
    if (!stats.period_to || period > stats.period_to) stats.period_to = period;

    // SENTIMENT + QUESTION STANCE
    const s = classifySentiment(pii.text);
    const si = s.sentiment === 'positive' ? 0 : s.sentiment === 'neutral' ? 1 : s.sentiment === 'negative' ? 2 : s.sentiment === 'mixed' ? 3 : 4;
    const q = s.isQuestion ? 1 : 0;

    for (const topicId of matched) {
      stats.messages_by_topic[topicId] = (stats.messages_by_topic[topicId] ?? 0) + 1;
      const k = `${geo}|${topicId}|${period}`;
      let row = acc.get(k);
      if (!row) {
        row = { g: geo, t: topicId, p: period, c: [0, 0, 0, 0, 0, 0] };
        acc.set(k, row);
      }
      row.c[si] += 1;
      row.c[5] += q;
    }
  }

  const aggregates: CivicAggregateRow[] = [...acc.values()].map((r) => ({
    geo_id: r.g,
    topic_id: r.t,
    period: r.p,
    n_messages: r.c[0] + r.c[1] + r.c[2] + r.c[3] + r.c[4],
    n_positive: r.c[0],
    n_neutral: r.c[1],
    n_negative: r.c[2],
    n_mixed: r.c[3],
    n_unclear: r.c[4],
    n_questions: r.c[5]
  }));

  aggregates.sort(
    (a, b) =>
      a.geo_id.localeCompare(b.geo_id) ||
      a.topic_id.localeCompare(b.topic_id) ||
      a.period.localeCompare(b.period)
  );

  return { aggregates, stats, pii_counts: piiCounts };
}
