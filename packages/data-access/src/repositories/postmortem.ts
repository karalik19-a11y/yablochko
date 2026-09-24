import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db.js';
import { getElection } from './elections.js';
import type { ElectionDetail } from './elections.js';

/**
 * Election Postmortem (Этап 9): авто-сборка разбора выборов из четырёх
 * НЕСМЕШИВАЕМЫХ блоков — OFFICIAL RESULT / PARTY INTERPRETATION /
 * INDEPENDENT ANALYSIS / MODEL INFERENCE. Авто-переключение режима по дате
 * выборов (до / день / после). Никаких персональных предсказаний; модельные
 * строки всегда помечены и не смешиваются с официальными результатами.
 */

export const PostmortemBlocksFile = z.object({
  meta: z.object({ note: z.string(), methodology: z.string() }).passthrough(),
  blocks: z.array(
    z.object({
      block_id: z.string(),
      election_id: z.string(),
      block_kind: z.enum(['official_result', 'party_interpretation', 'independent_analysis', 'model_inference']),
      section_key: z.string(),
      title: z.string(),
      status: z.enum(['pending', 'ready', 'insufficient_data']),
      source_id: z.string().nullable().default(null),
      data_mode: z.string().default('SEED'),
      note: z.string().nullable().default(null),
      rows: z
        .array(
          z.object({
            label: z.string(),
            text: z.string(),
            statement_category: z.string().nullable().default(null),
            date: z.string().nullable().default(null)
          })
        )
        .default([])
    })
  )
});
export type PostmortemBlocksFile = z.infer<typeof PostmortemBlocksFile>;

export function loadPostmortemBlocks(path: string): PostmortemBlocksFile {
  return PostmortemBlocksFile.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export function seedPostmortemBlocks(
  db: Db,
  file: PostmortemBlocksFile
): { upserted: number } {
  const ts = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO postmortem_blocks (block_id, election_id, block_kind, section_key, title,
      payload_json, source_id, data_mode, verification_status, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?, ?, ?)
    ON CONFLICT(block_id) DO UPDATE SET title=excluded.title, payload_json=excluded.payload_json,
      source_id=excluded.source_id, data_mode=excluded.data_mode, status=excluded.status,
      note=excluded.note, updated_at=excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const b of file.blocks) {
      up.run(b.block_id, b.election_id, b.block_kind, b.section_key, b.title, JSON.stringify(b.rows),
        b.source_id, b.data_mode, b.status, b.note, ts, ts);
    }
    db.prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, at, details)
       VALUES ('seed', 'postmortem_blocks_seed', 'postmortem_blocks', NULL, ?, ?)`
    ).run(ts, JSON.stringify({ blocks: file.blocks.length }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { upserted: file.blocks.length };
}

// ---------- Фаза выборов (авто-переключение режима) ----------

export type ElectionPhase = 'pre' | 'election_day' | 'postmortem';

/** Чистая функция фазы: до / день выборов / постмортем. Покрыта тестами. */
export function getElectionPhase(electionDate: string, nowIso: string): ElectionPhase {
  const d = electionDate.slice(0, 10);
  const now = nowIso.slice(0, 10);
  if (now < d) return 'pre';
  if (now === d) return 'election_day';
  return 'postmortem';
}

// ---------- Отчёт ----------

export interface PostmortemRow {
  label: string;
  value: string | null;
  votes: number | null;
  percent: number | null;
  seats: number | null;
  /** Дельта в процентных пунктах (только MODEL INFERENCE). */
  delta_pp: number | null;
  source_id: string | null;
  source_name: string | null;
  data_mode: string;
  statement_category: 'OFFICIAL_PARTY_STATEMENT' | 'FACT' | 'ANALYSIS' | 'MODEL' | null;
  note: string | null;
}

export interface PostmortemBlock {
  kind: 'official_result' | 'party_interpretation' | 'independent_analysis' | 'model_inference';
  status: 'pending' | 'ready' | 'insufficient_data';
  title: string;
  note: string | null;
  rows: PostmortemRow[];
  methodology: string | null;
  data_mode: string;
}

export interface PostmortemReport {
  election: {
    election_id: string;
    name: string;
    election_date: string;
    level: string;
    data_mode: string;
    phase: ElectionPhase;
    days_since_election: number | null;
    previous_election_id: string | null;
    previous_name: string | null;
  };
  phase: ElectionPhase;
  blocks: PostmortemBlock[];
  data_quality: {
    blocks: Array<{ kind: string; status: string }>;
    synthetic_blocks: number;
    unverified_rows: number;
    rows_without_source: number;
    note: string;
  };
  methodology: string;
}

const BLOCK_ORDER = ['official_result', 'party_interpretation', 'independent_analysis', 'model_inference'] as const;
const BLOCK_TITLES: Record<(typeof BLOCK_ORDER)[number], string> = {
  official_result: 'OFFICIAL RESULT — официальные результаты',
  party_interpretation: 'PARTY INTERPRETATION — интерпретация партии',
  independent_analysis: 'INDEPENDENT ANALYSIS — независимый анализ',
  model_inference: 'MODEL INFERENCE — модельные вычисления'
};

function sourceNameOf(db: Db, sourceId: string | null): string | null {
  if (!sourceId) return null;
  const r = db.prepare(`SELECT name FROM sources WHERE source_id = ?`).get(sourceId) as
    | { name: string }
    | undefined;
  return r?.name ?? sourceId;
}

function previousElectionOf(db: Db, e: ElectionDetail): ElectionDetail | null {
  const r = db
    .prepare(
      `SELECT election_id FROM elections
       WHERE level = ? AND election_type = ? AND election_date < ? AND election_id != ?
       ORDER BY election_date DESC LIMIT 1`
    )
    .get(e.level, e.election_type, e.election_date, e.election_id) as
    | { election_id: string }
    | undefined;
  return r ? getElection(db, r.election_id) : null;
}

function officialResultBlock(db: Db, e: ElectionDetail, phase: ElectionPhase): PostmortemBlock {
  const rows: PostmortemRow[] = [];
  const srcName = sourceNameOf(db, e.official_source_id);
  for (const r of e.results) {
    rows.push({
      label: r.party_name ?? '—',
      value: null,
      votes: r.votes,
      percent: r.percent,
      seats: r.seats,
      delta_pp: null,
      source_id: e.official_source_id,
      source_name: srcName,
      data_mode: e.data_mode,
      statement_category: 'FACT',
      note: null
    });
  }
  if (e.turnout) {
    rows.push({
      label: 'Явка',
      value: `${e.turnout.percent.toFixed(1)}% (${e.turnout.ballots_cast.toLocaleString('ru-RU')} из ${e.turnout.voters_registered.toLocaleString('ru-RU')})`,
      votes: null,
      percent: e.turnout.percent,
      seats: null,
      delta_pp: null,
      source_id: e.official_source_id,
      source_name: srcName,
      data_mode: e.data_mode,
      statement_category: 'FACT',
      note: e.turnout.valid_ballots !== null ? `действительных бюллетеней: ${e.turnout.valid_ballots.toLocaleString('ru-RU')}` : null
    });
  }
  const hasData = e.results.length > 0 || e.turnout !== null;
  let status: PostmortemBlock['status'];
  let note: string | null;
  if (hasData) {
    status = 'ready';
    note =
      e.data_mode === 'SYNTHETIC'
        ? 'Значения — SYNTHETIC-приближения (grade D), не официальные данные ЦИК; заменяются при импорте протоколов.'
        : null;
  } else if (phase === 'postmortem') {
    status = 'insufficient_data';
    note = 'INSUFFICIENT DATA: выборы завершены, но официальные результаты не внесены. Внесение — только из ЦИК/избиркомов после публикации протоколов; результаты не моделируются.';
  } else {
    status = 'pending';
    note = 'Выборы ещё не завершены: официальные результаты появятся после дня голосования.';
  }
  return {
    kind: 'official_result',
    status,
    title: BLOCK_TITLES.official_result,
    note,
    rows,
    methodology: 'Каждая строка результата ссылается на источник (official_source_id); категории FACT.',
    data_mode: e.data_mode
  };
}

function seededBlock(
  db: Db,
  electionId: string,
  kind: 'party_interpretation' | 'independent_analysis',
  fallbackNote: string
): PostmortemBlock {
  const r = db
    .prepare(
      `SELECT * FROM postmortem_blocks WHERE election_id = ? AND block_kind = ? ORDER BY section_key LIMIT 1`
    )
    .get(electionId, kind) as Record<string, unknown> | undefined;
  if (!r) {
    return {
      kind,
      status: 'insufficient_data',
      title: BLOCK_TITLES[kind],
      note: `INSUFFICIENT DATA. ${fallbackNote}`,
      rows: [],
      methodology: null,
      data_mode: 'SEED'
    };
  }
  type SeedRow = { label: string; text: string; statement_category: string | null; date: string | null };
  const seedRows = JSON.parse(String(r.payload_json)) as SeedRow[];
  const rows: PostmortemRow[] = seedRows.map((s) => ({
    label: s.label,
    value: s.text,
    votes: null,
    percent: null,
    seats: null,
    delta_pp: null,
    source_id: (r.source_id as string | null) ?? null,
    source_name: sourceNameOf(db, (r.source_id as string | null) ?? null),
    data_mode: String(r.data_mode),
    statement_category: (s.statement_category as PostmortemRow['statement_category']) ?? null,
    note: s.date ? `дата: ${s.date}` : null
  }));
  return {
    kind,
    status: (r.status as PostmortemBlock['status']) ?? 'pending',
    title: String(r.title),
    note: (r.note as string | null) ?? null,
    rows,
    methodology: null,
    data_mode: String(r.data_mode)
  };
}

const MODEL_METHODOLOGY =
  'MODEL INFERENCE: вычисляемое сравнение с предыдущими выборами того же типа (база — ';

function modelInferenceBlock(
  db: Db,
  e: ElectionDetail,
  prev: ElectionDetail | null,
  phase: ElectionPhase
): PostmortemBlock {
  const rows: PostmortemRow[] = [];
  if (!prev) {
    return {
      kind: 'model_inference',
      status: 'insufficient_data',
      title: BLOCK_TITLES.model_inference,
      note: 'INSUFFICIENT DATA: нет предыдущих выборов того же типа для сравнения.',
      rows: [],
      methodology: MODEL_METHODOLOGY + 'нет базы). Не официальный результат и не прогноз.',
      data_mode: 'MODEL'
    };
  }
  const curList = e.results.find((r) => r.is_party_list === 1 && r.is_yabloko === 1) ?? null;
  const prevList = prev.results.find((r) => r.is_party_list === 1 && r.is_yabloko === 1) ?? null;
  if (curList && prevList) {
    if (curList.percent !== null && prevList.percent !== null) {
      rows.push({
        label: 'Доля по спискам, п.п. к предыдущим выборам',
        value: null,
        votes: null,
        percent: curList.percent,
        seats: null,
        delta_pp: Math.round((curList.percent - prevList.percent) * 100) / 100,
        source_id: null,
        source_name: `база: ${prev.name} (${prev.election_date.slice(0, 4)}, ${prev.data_mode})`,
        data_mode: 'MODEL',
        statement_category: 'MODEL',
        note: `база: ${prevList.percent.toFixed(2)}%`
      });
    }
    if (curList.seats !== null && prevList.seats !== null) {
      rows.push({
        label: 'Мандаты по спискам (дельта)',
        value: null,
        votes: null,
        percent: null,
        seats: curList.seats,
        delta_pp: curList.seats - prevList.seats,
        source_id: null,
        source_name: `база: ${prev.name}`,
        data_mode: 'MODEL',
        statement_category: 'MODEL',
        note: `база: ${prevList.seats} мандатов`
      });
    }
  }
  if (e.turnout && prev.turnout) {
    rows.push({
      label: 'Явка, п.п. к предыдущим выборам',
      value: null,
      votes: null,
      percent: e.turnout.percent,
      seats: null,
      delta_pp: Math.round((e.turnout.percent - prev.turnout.percent) * 100) / 100,
      source_id: null,
      source_name: `база: ${prev.name} (${prev.data_mode})`,
      data_mode: 'MODEL',
      statement_category: 'MODEL',
      note: `база: ${prev.turnout.percent.toFixed(1)}%`
    });
  }
  const ready = rows.length > 0;
  const methodFull =
    MODEL_METHODOLOGY +
    `${prev.name} от ${prev.election_date}, data_mode=${prev.data_mode})` +
    (e.data_mode === 'SYNTHETIC' ? '; текущие значения SYNTHETIC' : '') +
    '. Не официальный результат, не прогноз и не оценка; констатация разности.';
  return {
    kind: 'model_inference',
    status: ready ? 'ready' : phase === 'postmortem' ? 'insufficient_data' : 'pending',
    title: BLOCK_TITLES.model_inference,
    note: ready
      ? null
      : 'INSUFFICIENT DATA: для вычисления динамики нужны результаты текущих выборов (модель не строит прогнозы).',
    rows,
    methodology: methodFull,
    data_mode: 'MODEL'
  };
}

export interface PostmortemOptions {
  now?: string;
  /** Методология из датасета (meta.methodology). */
  methodology?: string;
}

/** Полный postmortem-отчёт по выборам (4 блока в фиксированном порядке). */
export function getPostmortem(db: Db, electionId: string, opts: PostmortemOptions = {}): PostmortemReport | null {
  const e = getElection(db, electionId);
  if (!e) return null;
  const now = opts.now ?? new Date().toISOString();
  const phase = getElectionPhase(e.election_date, now);
  const prev = previousElectionOf(db, e);
  const daysSince =
    phase === 'postmortem'
      ? Math.max(0, Math.round((Date.parse(now.slice(0, 10)) - Date.parse(e.election_date)) / 86_400_000))
      : null;

  const blocks: PostmortemBlock[] = [
    officialResultBlock(db, e, phase),
    seededBlock(db, electionId, 'party_interpretation',
      'Заявления партии по этим выборам не внесены; добавляются только из официальных источников (OFFICIAL PARTY STATEMENT).'),
    seededBlock(db, electionId, 'independent_analysis',
      'Наблюдатели/СМИ/суды подключаются из внешних источников (Этапы 10–11); моделью не заполняются.'),
    modelInferenceBlock(db, e, prev, phase)
  ];
  blocks.sort((a, b) => BLOCK_ORDER.indexOf(a.kind) - BLOCK_ORDER.indexOf(b.kind));

  const unverified = blocks.reduce((acc, b) => acc + b.rows.filter((r) => r.data_mode !== 'LIVE').length, 0);
  const withoutSource = blocks.reduce(
    (acc, b) => acc + b.rows.filter((r) => r.source_id === null && r.statement_category !== 'MODEL').length,
    0
  );

  return {
    election: {
      election_id: e.election_id,
      name: e.name,
      election_date: e.election_date,
      level: e.level,
      data_mode: e.data_mode,
      phase,
      days_since_election: daysSince,
      previous_election_id: prev?.election_id ?? null,
      previous_name: prev?.name ?? null
    },
    phase,
    blocks,
    data_quality: {
      blocks: blocks.map((b) => ({ kind: b.kind, status: b.status })),
      synthetic_blocks: blocks.filter((b) => b.data_mode === 'SYNTHETIC').length,
      unverified_rows: unverified,
      rows_without_source: withoutSource,
      note:
        'DATA QUALITY: SYNTHETIC/UNVERIFIED указаны честно; блоки не смешиваются; официальные результаты вносятся только из ЦИК/избиркомов.'
    },
    methodology:
      opts.methodology ??
      'Postmortem собирается автоматически: OFFICIAL RESULT (с источником) + PARTY INTERPRETATION (OFFICIAL PARTY STATEMENT) + INDEPENDENT ANALYSIS (внешние данные) + MODEL INFERENCE (помеченные вычисления). Блоки несмешиваемы.'
  };
}
