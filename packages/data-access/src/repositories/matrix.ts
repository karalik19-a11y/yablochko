import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';
import { listPositionsComputed } from './party.js';
import { getTerritoryMetrics } from './metrics.js';
import { getCivicOverview, loadTopicsFromDb, K_MIN_MESSAGES } from './civic.js';

/**
 * Position Matrix (Этап 7): сопоставление позиций партии (ОФИЦИАЛЬНОЕ ЗАЯВЛЕНИЕ
 * ПАРТИИ), общественных настроений (АНАЛИЗ, только агрегаты) и региональных
 * показателей (ФАКТ) с явным статусом сопоставления (МОДЕЛЬ). Категории
 * жёстко разведены: позиция ≠ мнение; совпадение позиций (согласие) никогда
 * не вычисляется из тональности темы. Рекомендации не формируются.
 */

export const TopicLinksFile = z.object({
  meta: z
    .object({
      note: z.string(),
      methodology: z.string(),
      comparison_rules: z.string()
    })
    .passthrough(),
  links: z.array(
    z.object({
      link_id: z.string(),
      civic_topic_id: z.string(),
      position_topic: z.string().nullable(),
      metric_codes: z.array(z.string()).default([]),
      note: z.string().optional()
    })
  )
});
export type TopicLinksFile = z.infer<typeof TopicLinksFile>;

export function loadTopicLinks(path: string): TopicLinksFile {
  return TopicLinksFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

// ---------- Типы блоков строки матрицы ----------

export interface MatrixPositionBlock {
  position_id: string;
  topic: string;
  exact_position: string;
  date_from: string;
  date_from_precision: string;
  date_to: string | null;
  confidence: string;
  verification_status: string;
  current_status: string;
  statement_category: 'OFFICIAL_PARTY_STATEMENT';
  source_id: string;
  source_name: string | null;
  party_document_id: string | null;
  party_document_title: string | null;
}

export interface MatrixOpinionBlock {
  civic_topic_id: string;
  topic_name: string;
  data_mode: string;
  last3_n: number;
  prev3_n: number;
  growth_pct: number | null;
  classification: string;
  insufficient: boolean;
  mix: { pos: number; neu: number; neg: number; mixed: number; unclear: number };
  neg_share_pct: number | null;
  pos_share_pct: number | null;
  questions: number;
}

export interface MatrixRegionalBlock {
  metric_code: string;
  metric_name: string;
  unit: string;
  latest_period: string | null;
  latest_value: number | null;
  trend_pct: number | null;
  data_mode: string;
}

export interface MatrixComparison {
  status: 'agenda_overlap' | 'agenda_divergence' | 'uncertainty';
  /** Формулировка «наблюдается / не наблюдается совпадение…». */
  wording: string;
}

export interface MatrixRow {
  link_id: string | null;
  link_note: string | null;
  civic_topic_id: string;
  civic_topic_name: string;
  category: string | null;
  position: MatrixPositionBlock | null;
  opinion: MatrixOpinionBlock | null;
  regional: MatrixRegionalBlock[];
  comparison: MatrixComparison;
  caveats: string[];
}

export interface PositionMatrix {
  geo_id: string;
  months: number;
  k_min: number;
  rows: MatrixRow[];
  /** Позиции реестра, не связанные ни с одной темой настроений. */
  unlinked_positions: Array<{ position_id: string; topic: string }>;
  methodology: string;
  comparison_rules: string;
  /** Глобальные оговорки категорий (не смешивать ФАКТ / ЗАЯВЛЕНИЕ ПАРТИИ / АНАЛИЗ / МОДЕЛЬ). */
  category_rules: string[];
}

/** Категорийные оговорки — одинаковые для всех строк (жёсткое разведение). */
export const MATRIX_CATEGORY_RULES: string[] = [
  'Позиция партии — ЗАЯВЛЕНИЕ ПАРТИИ: берётся только из реестра официальных позиций; ИИ не формулирует и не дополняет позиции.',
  'Общественное мнение — АНАЛИЗ: агрегаты Civic Sentiment Engine (SYNTHETIC до реального импорта); тональность темы — не согласие и не несогласие с позицией.',
  'Региональные данные — ФАКТ: SYNTHETIC до импорта официальной статистики.',
  'Сопоставление — МОДЕЛЬ: сравнивается совпадение повестки, а не согласие с позицией; не причинность и не рекомендация.',
  'Совпадение позиций (согласие общества с позицией) не оценивается: прямых измерений согласия в данных нет.'
];

function rowCaveats(): string[] {
  return [
    'ЗАЯВЛЕНИЕ ПАРТИИ: позиция требует верификации официальным документом (UNVERIFIED).',
    'АНАЛИЗ: настроения — SYNTHETIC-агрегаты по темам; персональные записи отсутствуют.',
    'МОДЕЛЬ: статус сопоставления вычислен по зафиксированным правилам topic_links.json.'
  ];
}

function comparisonFor(
  position: MatrixPositionBlock | null,
  opinion: MatrixOpinionBlock | null,
  kMin: number,
  positionTopic: string | null
): MatrixComparison {
  if (!opinion || (opinion.last3_n === 0 && opinion.prev3_n === 0)) {
    return {
      status: 'uncertainty',
      wording: 'INSUFFICIENT DATA: по теме нет данных настроений в выбранной географии/окне; совпадение повестки не оценивается.'
    };
  }
  if (opinion.insufficient || opinion.last3_n < kMin) {
    return {
      status: 'uncertainty',
      wording: `INSUFFICIENT DATA: выборка темы за последние 3 месяца (n=${opinion.last3_n}) ниже порога k_min=${kMin}; совпадение повестки не оценивается.`
    };
  }
  if (position) {
    return {
      status: 'agenda_overlap',
      wording:
        `Наблюдается совпадение повестки: тема статистически значима в настроениях (n=${opinion.last3_n} за 3 мес), ` +
        `в реестре есть актуальная документированная позиция по теме «${positionTopic ?? position.topic}». ` +
        'Совпадение позиций (согласие общества с позицией) не оценивается: тональность темы ≠ поддержка позиции.'
    };
  }
  return {
    status: 'agenda_divergence',
    wording:
      `Не наблюдается документированной позиции партии по теме при выраженной общественной значимости (n=${opinion.last3_n} за 3 мес). ` +
      'Это констатация отсутствия записи в реестре, не оценка позиции и не рекомендация.'
  };
}

export interface PositionMatrixOptions {
  links: TopicLinksFile;
  geoId: string;
  /** окно настроений, 3…36 (по умолчанию 12) */
  months?: number;
  asOf?: string;
  /** Переопределение методологии (иначе — из links.meta). */
  methodology?: string;
}

/** Матрица по всем темам справочника (включая темы без данных — честные пустые блоки). */
export function computePositionMatrix(db: Db, opts: PositionMatrixOptions): PositionMatrix {
  const months = Math.min(Math.max(opts.months ?? 12, 3), 36);
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const kMin = K_MIN_MESSAGES;

  // Активные позиции: UNVERIFIED — валидный активный статус (до верификации).
  const positions = listPositionsComputed(db, asOf).filter(
    (p) => p.current_status !== 'FUTURE' && p.current_status !== 'EXPIRED' && p.current_status !== 'SUPERSEDED'
  );
  const positionByTopic = new Map<string, MatrixPositionBlock>();
  for (const p of positions) {
    if (positionByTopic.has(p.topic)) continue; // первая актуальная по теме
    positionByTopic.set(p.topic, {
      position_id: p.position_id,
      topic: p.topic,
      exact_position: p.exact_position,
      date_from: p.date_from,
      date_from_precision: p.date_from_precision,
      date_to: p.date_to,
      confidence: p.confidence,
      verification_status: p.verification_status,
      current_status: p.current_status,
      statement_category: 'OFFICIAL_PARTY_STATEMENT',
      source_id: p.source_id,
      source_name: p.source_name,
      party_document_id: p.party_document_id,
      party_document_title: p.party_document_title
    });
  }

  const civic = getCivicOverview(db, opts.geoId, { months });
  const opinionByTopic = new Map<string, MatrixOpinionBlock>();
  if (civic) {
    for (const t of civic.topics) {
      const sum = t.totals.mix.pos + t.totals.mix.neu + t.totals.mix.neg + t.totals.mix.mixed + t.totals.mix.unclear;
      opinionByTopic.set(t.topic_id, {
        civic_topic_id: t.topic_id,
        topic_name: t.topic_name,
        data_mode: civic.data_mode,
        last3_n: t.last3_n,
        prev3_n: t.prev3_n,
        growth_pct: t.growth_pct,
        classification: t.classification,
        insufficient: t.insufficient,
        mix: t.totals.mix,
        neg_share_pct: t.totals.n > 0 ? (t.totals.mix.neg / sum) * 100 : null,
        pos_share_pct: t.totals.n > 0 ? (t.totals.mix.pos / sum) * 100 : null,
        questions: t.totals.questions
      });
    }
  }

  const metricMap = new Map<string, MatrixRegionalBlock>();
  for (const d of getTerritoryMetrics(db, opts.geoId)) {
    for (const m of d.metrics) {
      if (metricMap.has(m.code)) continue;
      metricMap.set(m.code, {
        metric_code: m.code,
        metric_name: m.name,
        unit: m.unit,
        latest_period: m.latest?.period ?? null,
        latest_value: m.latest?.value ?? null,
        trend_pct: m.trend_pct,
        data_mode: m.provenance.data_mode
      });
    }
  }

  const linkByTopic = new Map<string, TopicLinksFile['links'][number]>();
  for (const l of opts.links.links) linkByTopic.set(l.civic_topic_id, l);

  const allTopics = loadTopicsFromDb(db);
  const rows: MatrixRow[] = [];
  const linkedPositionTopics = new Set<string>();

  for (const t of allTopics) {
    const link = linkByTopic.get(t.topic_id);
    const opinion = opinionByTopic.get(t.topic_id) ?? null;
    const position = link?.position_topic ? (positionByTopic.get(link.position_topic) ?? null) : null;
    if (position && link?.position_topic) linkedPositionTopics.add(link.position_topic);

    const regional: MatrixRegionalBlock[] = [];
    for (const code of link?.metric_codes ?? []) {
      const mb = metricMap.get(code);
      if (mb) regional.push(mb);
    }

    rows.push({
      link_id: link?.link_id ?? null,
      link_note: link?.note ?? null,
      civic_topic_id: t.topic_id,
      civic_topic_name: t.name,
      category: t.category,
      position,
      opinion,
      regional,
      comparison: comparisonFor(position, opinion, kMin, link?.position_topic ?? null),
      caveats: rowCaveats()
    });
  }

  // Позиции без связи с темами настроений — не теряются.
  const unlinked = positions
    .filter((p) => !linkedPositionTopics.has(p.topic))
    .map((p) => ({ position_id: p.position_id, topic: p.topic }));

  // Сортировка: сначала совпадение повестки, затем расхождение, затем неопределённость;
  // внутри — по объёму темы.
  const order = { agenda_overlap: 0, agenda_divergence: 1, uncertainty: 2 } as const;
  rows.sort(
    (a, b) =>
      order[a.comparison.status] - order[b.comparison.status] ||
      (b.opinion?.last3_n ?? 0) - (a.opinion?.last3_n ?? 0)
  );

  return {
    geo_id: opts.geoId,
    months,
    k_min: kMin,
    rows,
    unlinked_positions: unlinked,
    methodology: opts.methodology ?? opts.links.meta.methodology,
    comparison_rules: opts.links.meta.comparison_rules,
    category_rules: MATRIX_CATEGORY_RULES
  };
}
