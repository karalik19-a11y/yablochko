import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import {
  API,
  ElectionsList,
  ElectionDetail,
  YablokoElectionHistory,
  RegionalElectionHistory
} from '@yabloko/api-contract';
import type { ElectionListItem } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * ELECTIONS (Этап 8): база выборов с официальным источником у каждой строки.
 * До импорта ЦИК значения — SYNTHETIC (честные бейджи). Предсказаний и
 * персональных вероятностей нет. Кандидаты — только из официальных списков.
 */

const SYN_BADGE = (
  <Badge tone="warn" title="SYNTHETIC-приближения (grade D); заменяются официальными данными ЦИК при импорте">
    SYN
  </Badge>
);

function fmtN(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString('ru-RU');
}

function ElectionDetailBlock({ id, onBack }: { id: string; onBack: () => void }) {
  const state = useApi(`${API.electionDetail}?id=${encodeURIComponent(id)}`, ElectionDetail);
  if (state.status === 'loading') return <Skeleton h={160} />;
  if (state.status === 'error') return <ErrorBox message={`Выборы недоступны: ${state.error}`} onRetry={state.reload} />;
  if (!state.data) return <EmptyState title="Выборы не найдены" />;
  const d = state.data;
  return (
    <Panel
      title={d.name}
      actions={
        <button className="btn small" onClick={onBack}>
          ← К списку
        </button>
      }
    >
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="violet">{d.election_date}</Badge>
        <Badge tone="muted">{d.level}</Badge>
        {d.electoral_system && <Badge tone="info">{d.electoral_system}</Badge>}
        {d.seats_total !== null && <Badge tone="muted">мандатов: {d.seats_total}</Badge>}
        {d.data_mode === 'SYNTHETIC' && SYN_BADGE}
        <Badge tone={d.verification_status === 'VERIFIED' ? 'accent' : 'warn'}>{d.verification_status}</Badge>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        {d.results.map((r) => (
          <div
            key={r.result_id}
            style={{ display: 'grid', gridTemplateColumns: '1.2fr auto auto auto', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}
          >
            <span className="small" style={{ fontWeight: r.is_yabloko ? 700 : 400 }}>
              {r.party_name ?? '—'}
              {r.is_yabloko === 1 ? ' · ЯБЛОКО' : ''}
            </span>
            <span className="mono small">{fmtN(r.votes)}</span>
            <span className="mono small">{r.percent !== null ? `${r.percent.toFixed(2)}%` : '—'}</span>
            <span className="small">мандаты: {r.seats ?? '—'}</span>
          </div>
        ))}
      </div>

      {d.turnout && (
        <div className="small" style={{ marginTop: 10 }}>
          Явка: <span className="mono">{d.turnout.percent.toFixed(1)}%</span> · проголосовало {fmtN(d.turnout.ballots_cast)} из{' '}
          {fmtN(d.turnout.voters_registered)} (действительных: {fmtN(d.turnout.valid_ballots)})
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <span className="small faint">Источник: {d.provenance.source_id} · data_mode: {d.provenance.data_mode}</span>
        <ul className="small faint" style={{ paddingLeft: 18, marginTop: 4 }}>
          {d.provenance.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function YablokoHistoryBlock() {
  const state = useApi(API.electionsYablokoHistory, YablokoElectionHistory);
  if (state.status === 'loading') return <Skeleton h={180} />;
  if (state.status === 'error') return <ErrorBox message={`История недоступна: ${state.error}`} onRetry={state.reload} />;
  if (!state.data || state.data.federal.length === 0)
    return <EmptyState title="Нет данных" note="Импорт истории Госдум выполняется на Этапе 8 (fixtures/CI)." />;
  const max = Math.max(...state.data.federal.map((p) => p.percent ?? 0), 5);
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
        {state.data.federal.map((p) => (
          <div key={p.election_id} style={{ textAlign: 'center', width: 64 }}>
            <div
              title={`${p.name}: ${p.percent?.toFixed(2)}%, мандатов ${p.seats ?? 0}${p.passed_barrier ? ' (5% пройден)' : ''}`}
              style={{
                height: `${Math.max(((p.percent ?? 0) / max) * 110, 3)}px`,
                background: p.passed_barrier ? 'var(--accent)' : 'var(--text-faint)',
                opacity: p.passed_barrier ? 0.9 : 0.5,
                margin: '0 auto',
                width: 34
              }}
            />
            <div className="small mono" style={{ marginTop: 4 }}>
              {p.percent?.toFixed(1)}%
            </div>
            <div className="small faint">{p.election_date.slice(0, 4)}</div>
            <div className="small faint">{p.seats ?? 0} мнд</div>
          </div>
        ))}
      </div>
      <div className="small faint" style={{ marginTop: 10 }}>
        Линия 5% — проходной барьер по партийным спискам. Высота столбца — констатация результата, не оценка. Значения
        SYNTHETIC до сверки с ЦИК.
      </div>
    </>
  );
}

function RegionalBlock({ region }: { region?: string }) {
  const state = useApi(
    region ? `${API.electionsRegional}?region=${encodeURIComponent(region)}` : API.electionsRegional,
    RegionalElectionHistory
  );
  if (state.status === 'loading') return <Skeleton h={140} />;
  if (state.status === 'error') return <ErrorBox message={`Регионы недоступны: ${state.error}`} onRetry={state.reload} />;
  if (!state.data || state.data.items.length === 0)
    return <EmptyState title="Нет региональных выборов в базе" note="Импорт избиркомов подключается (Этап 8+)." />;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {state.data.items.map((r) => (
        <div
          key={r.election_id}
          style={{ display: 'grid', gridTemplateColumns: '1.6fr auto auto auto auto', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}
        >
          <span className="small">{r.name}</span>
          <span className="small faint mono">{r.election_date}</span>
          <span className="mono small">ЯБЛОКО: {r.yabloko_percent !== null ? `${r.yabloko_percent.toFixed(1)}%` : '—'}</span>
          <span className="small">
            мандаты: {r.yabloko_seats ?? '—'}
            {r.seats_total !== null ? <span className="faint"> / {r.seats_total}</span> : null}
          </span>
          <span className="small faint">явка {r.turnout_percent !== null ? `${r.turnout_percent.toFixed(1)}%` : '—'}</span>
        </div>
      ))}
    </div>
  );
}

export function ElectionsScreen() {
  const state = useApi(API.electionsList, ElectionsList);
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState<string>('');

  const items = (state.data?.items ?? []).filter((e: ElectionListItem) => !level || e.level === level);

  return (
    <>
      <div>
        <h2 className="section-title">ELECTIONS</h2>
        <div className="section-sub">
          База выборов: результаты и явка со ссылкой на официальный источник у каждой строки. До импорта ЦИК/избиркомов
          значения — SYNTHETIC-приближения (честные бейджи). Персональные предсказания и вероятности отсутствуют.
        </div>
      </div>

      <div className="row wrap">
        <Badge tone="violet">Госдума: 8 созывов</Badge>
        <Badge tone="muted">Региональный пилот: 3 кампании</Badge>
        <Badge tone="warn">Кандидаты: ждут официального импорта</Badge>
      </div>

      <Panel title="ЯБЛОКО НА ВЫБОРАХ — Госдума (партийные списки)">{<YablokoHistoryBlock />}</Panel>

      <Panel
        title="ВЫБОРЫ"
        actions={
          <div className="row wrap">
            <button className={`btn small ${level === '' ? 'primary' : ''}`} onClick={() => setLevel('')}>
              Все
            </button>
            <button className={`btn small ${level === 'federal' ? 'primary' : ''}`} onClick={() => setLevel('federal')}>
              Федеральные
            </button>
            <button className={`btn small ${level === 'region' ? 'primary' : ''}`} onClick={() => setLevel('region')}>
              Региональные
            </button>
          </div>
        }
      >
        {state.status === 'loading' && <Skeleton h={200} />}
        {state.status === 'error' && (
          <ErrorBox message={`База выборов недоступна: ${state.error}`} onRetry={state.reload} />
        )}
        {state.status === 'ready' && selected !== null && (
          <ElectionDetailBlock id={selected} onBack={() => setSelected(null)} />
        )}
        {state.status === 'ready' && selected === null && (
          <div style={{ display: 'grid', gap: 4 }}>
            {items.map((e) => (
              <button
                key={e.election_id}
                className="btn"
                onClick={() => setSelected(e.election_id)}
                style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 12, textAlign: 'left', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}
              >
                <span className="small mono faint">{e.election_date}</span>
                <span className="small">{e.name}</span>
                <span className="badge muted">{e.level}</span>
                {e.data_mode === 'SYNTHETIC' ? SYN_BADGE : <Badge tone="accent">LIVE</Badge>}
              </button>
            ))}
            {items.length === 0 && <EmptyState title="Выборы не найдены" />}
          </div>
        )}
      </Panel>

      <Panel title="РЕГИОНАЛЬНАЯ ИСТОРИЯ ВЫБОРОВ">{<RegionalBlock />}</Panel>
    </>
  );
}
