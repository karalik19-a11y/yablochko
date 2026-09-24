import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, ElectionsList, PostmortemReport } from '@yabloko/api-contract';
import type { PostmortemBlock, PostmortemRow } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * POSTMORTEM 2026 (Этап 9): авто-сборка разбора выборов из четырёх
 * НЕСМЕШИВАЕМЫХ блоков. Авто-переключение режима по дате выборов.
 * Официальные результаты — только из ЦИК; партия — только заявления;
 * независимый анализ — только внешние данные; модель — всегда помечена.
 */

const KIND_BADGE: Record<PostmortemBlock['kind'], { text: string; tone: 'accent' | 'violet' | 'info' | 'muted'; title: string }> = {
  official_result: { text: 'OFFICIAL RESULT · ФАКТ', tone: 'accent', title: 'Только внесённые официальные результаты (источник у каждой строки)' },
  party_interpretation: { text: 'PARTY INTERPRETATION · ЗАЯВЛЕНИЕ ПАРТИИ', tone: 'violet', title: 'Только официальные заявления партии; чисел результатов здесь нет' },
  independent_analysis: { text: 'INDEPENDENT ANALYSIS · ВНЕШНИЕ ДАННЫЕ', tone: 'info', title: 'Наблюдатели/СМИ/суды — только из внешних источников, моделью не заполняется' },
  model_inference: { text: 'MODEL INFERENCE · МОДЕЛЬ', tone: 'muted', title: 'Помеченные модельные вычисления; не официальный результат и не прогноз' }
};

const STATUS_BADGE: Record<PostmortemBlock['status'], { text: string; tone: 'accent' | 'warn' | 'muted' }> = {
  ready: { text: 'READY', tone: 'accent' },
  pending: { text: 'PENDING', tone: 'warn' },
  insufficient_data: { text: 'INSUFFICIENT DATA', tone: 'muted' }
};

function Row({ r }: { r: PostmortemRow }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr auto auto auto', gap: 12, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <span className="small" style={{ fontWeight: 600 }}>
          {r.label}
        </span>
        {r.value && (
          <div className="small" style={{ marginTop: 2 }}>
            {r.value}
          </div>
        )}
        {r.note && <div className="small faint">{r.note}</div>}
        <div className="small faint" style={{ marginTop: 2 }}>
          {r.source_name ?? (r.statement_category === 'MODEL' ? 'модельное вычисление' : '—')}
          {r.statement_category && <span> · {r.statement_category}</span>}
          {r.data_mode === 'SYNTHETIC' && <span> · SYNTHETIC</span>}
        </div>
      </div>
      <span className="mono small">{r.votes !== null ? r.votes.toLocaleString('ru-RU') : ''}</span>
      <span className="mono small">{r.percent !== null ? `${r.percent.toFixed(2)}%` : ''}</span>
      <span className="mono small">
        {r.seats !== null ? `${r.seats} мнд` : ''}
        {r.delta_pp !== null ? (
          <span title="Дельта к предыдущим выборам (модельная констатация, не оценка)">
            {' '}
            {r.delta_pp > 0 ? '+' : ''}
            {r.delta_pp.toFixed(2)}
            {r.label.includes('п.п') || r.label.includes('п.п.') ? '' : ' мнд'}
          </span>
        ) : (
          ''
        )}
      </span>
    </div>
  );
}

function Block({ b }: { b: PostmortemBlock }) {
  const kb = KIND_BADGE[b.kind];
  const sb = STATUS_BADGE[b.status];
  return (
    <Panel
      title={b.title}
      actions={
        <div className="row wrap" style={{ gap: 6 }}>
          <Badge tone={kb.tone} title={kb.title}>
            {kb.text}
          </Badge>
          <Badge tone={sb.tone} title="Статус наполнения блока">
            {sb.text}
          </Badge>
        </div>
      }
    >
      {b.rows.length === 0 ? (
        <EmptyState title="Нет данных" note={b.note ?? undefined} />
      ) : (
        <>
          {b.note && (
            <div className="small" style={{ marginBottom: 8, color: 'var(--text-faint)' }}>
              {b.note}
            </div>
          )}
          {b.rows.map((r, i) => (
            <Row key={i} r={r} />
          ))}
        </>
      )}
      {b.methodology && (
        <div className="small faint" style={{ marginTop: 8 }}>
          Methodology: {b.methodology}
        </div>
      )}
    </Panel>
  );
}

export function PostmortemScreen() {
  const elections = useApi(API.electionsList, ElectionsList);
  const [electionId, setElectionId] = useState('ru-gd-2026');
  const state = useApi(`${API.electionsPostmortem}?election=${encodeURIComponent(electionId)}`, PostmortemReport);

  const completed = (elections.data?.items ?? []).filter((e) => e.election_date <= '2026-09-24');

  return (
    <>
      <div>
        <h2 className="section-title">POSTMORTEM — ВЫБОРЫ 2026</h2>
        <div className="section-sub">
          Election Postmortem: авто-сборка разбора. Четыре несмешиваемых блока: официальный результат (FACT),
          интерпретация партии (OFFICIAL PARTY STATEMENT), независимый анализ (внешние данные), модельные вычисления
          (MODEL — не результат и не прогноз). Официальные результаты вносятся только из ЦИК/избиркомов.
        </div>
      </div>

      <Panel
        title="Выборы"
        actions={
          state.status === 'ready' && state.data ? (
            <Badge tone={state.data.phase === 'postmortem' ? 'accent' : 'warn'} title="Режим переключается автоматически по дате выборов">
              {state.data.phase === 'postmortem'
                ? `ПОСТМОРТЕМ · день ${state.data.election.days_since_election ?? 0} после выборов`
                : state.data.phase === 'election_day'
                  ? 'ДЕНЬ ГОЛОСОВАНИЯ'
                  : 'ДО ВЫБОРОВ'}
            </Badge>
          ) : undefined
        }
      >
        {elections.status === 'loading' && <Skeleton h={40} />}
        {elections.status === 'ready' && (
          <div className="row wrap">
            {completed.map((e) => (
              <button
                key={e.election_id}
                className={`btn small ${electionId === e.election_id ? 'primary' : ''}`}
                onClick={() => setElectionId(e.election_id)}
              >
                {e.name.replace('Выборы депутатов ', '').replace(' Государственной Думы', ' ГД')} · {e.election_date.slice(0, 4)}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {state.status === 'loading' && <Skeleton h={200} />}
      {state.status === 'error' && <ErrorBox message={`Постмортем недоступен: ${state.error}`} onRetry={state.reload} />}

      {state.status === 'ready' && state.data && (
        <>
          {state.data.blocks.map((b) => (
            <Block key={b.kind} b={b} />
          ))}

          <Panel title="DATA QUALITY">
            <div className="row wrap" style={{ gap: 8 }}>
              {state.data.data_quality.blocks.map((b) => (
                <Badge key={b.kind} tone={b.status === 'ready' ? 'accent' : b.status === 'pending' ? 'warn' : 'muted'}>
                  {b.kind}: {b.status}
                </Badge>
              ))}
              <Badge tone="warn" title="Блоков с SYNTHETIC-данными">
                SYNTHETIC блоков: {state.data.data_quality.synthetic_blocks}
              </Badge>
              <Badge tone="muted" title="Строк без LIVE-подтверждения">
                UNVERIFIED строк: {state.data.data_quality.unverified_rows}
              </Badge>
            </div>
            <div className="small faint" style={{ marginTop: 8 }}>
              {state.data.data_quality.note}
            </div>
            <div className="small faint" style={{ marginTop: 4 }}>
              Methodology: {state.data.methodology}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
