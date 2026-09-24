import { useMemo, useState } from 'react';
import {
  Badge,
  ConfidenceBadge,
  DataTable,
  EmptyState,
  ErrorBox,
  OfficialStatement,
  Panel,
  PositionStatusBadge,
  PrecisionDate,
  Skeleton,
  VerificationBadge
} from '@yabloko/ui';
import { API, PartyPosition as PartyPositionSchema } from '@yabloko/api-contract';
import type { PartyPosition } from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

const PositionsEnvelope = z.object({
  positions: z.array(PartyPositionSchema),
  conflicts: z.array(
    z.object({
      topic: z.string(),
      kind: z.string(),
      note: z.string()
    })
  ),
  stats: z.object({
    total: z.number(),
    current: z.number(),
    unverified: z.number(),
    topics: z.number()
  })
});
type PositionsData = z.infer<typeof PositionsEnvelope>;

export function PositionsScreen() {
  const [showHistory, setShowHistory] = useState(true);
  const state = useApi<PositionsData>(API.partyPositions, PositionsEnvelope);

  const rows = useMemo(() => {
    const list = state.data?.positions ?? [];
    return showHistory ? list : list.filter((p) => p.current_status === 'CURRENT' || p.current_status === 'UNVERIFIED');
  }, [state.data, showHistory]);

  return (
    <>
      <div>
        <h2 className="section-title">YABLOKO POSITION REGISTRY</h2>
        <div className="section-sub">
          Официальные позиции партии по темам с временно́й шкалой. Позиции —{' '}
          <strong>официальные заявления партии</strong>, а не факты и не мнение
          общества. Полная матрица «позиция ↔ общественное мнение» — Этап 7.
        </div>
      </div>

      {state.status === 'loading' && <Skeleton h={200} />}
      {state.status === 'error' && (
        <ErrorBox message={`Реестр позиций недоступен: ${state.error}`} onRetry={state.reload} />
      )}
      {state.status === 'ready' && state.data && (
        <>
          <div className="row wrap">
            <Badge tone="accent">CURRENT: {state.data.stats.current}</Badge>
            <Badge tone="warn">UNVERIFIED: {state.data.stats.unverified}</Badge>
            <Badge tone="muted">Всего: {state.data.stats.total}</Badge>
            <Badge tone="info">Тем: {state.data.stats.topics}</Badge>
            <div className="spacer" />
            <button className="btn small" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Скрыть историю' : 'Показать историю'}
            </button>
          </div>

          {state.data.conflicts.length > 0 && (
            <Panel title="Конфликты таймлайна (информационные)">
              {state.data.conflicts.map((c, i) => (
                <div key={i} className="small muted" style={{ marginBottom: 6 }}>
                  <Badge tone="violet">{c.kind}</Badge> {c.topic}: {c.note}
                </div>
              ))}
            </Panel>
          )}

          <DataTable
            rows={rows}
            columns={[
              {
                key: 'topic',
                header: 'Тема',
                width: '180px',
                render: (p) => <strong className="small">{p.topic}</strong>
              },
              {
                key: 'position',
                header: 'Позиция',
                render: (p: PartyPosition) => <OfficialStatement text={p.exact_position} />
              },
              {
                key: 'period',
                header: 'Период',
                width: '210px',
                render: (p) => (
                  <div className="small">
                    с <PrecisionDate date={p.date_from} precision={p.date_from_precision} />
                    <br />
                    {p.date_to ? (
                      <>
                        по <span className="mono">{p.date_to}</span>
                      </>
                    ) : (
                      <span className="faint">бессрочно</span>
                    )}
                    {p.superseded_by && (
                      <div className="faint">замещена: {p.superseded_by}</div>
                    )}
                  </div>
                )
              },
              {
                key: 'status',
                header: 'Статус',
                width: '150px',
                render: (p) => (
                  <div className="row wrap">
                    <PositionStatusBadge status={p.current_status} />
                    <VerificationBadge status={p.verification_status} />
                  </div>
                )
              },
              {
                key: 'confidence',
                header: 'Уверенность',
                width: '110px',
                render: (p) => <ConfidenceBadge confidence={p.confidence} />
              },
              {
                key: 'source',
                header: 'Источник / документ',
                width: '220px',
                render: (p) => (
                  <div className="source-ref">
                    <div>{p.source_name ?? p.source_id}</div>
                    {p.party_document_title && <div>{p.party_document_title}</div>}
                  </div>
                )
              }
            ]}
            empty={
              <EmptyState
                title="Позиции не найдены"
                note="Реестр пуст: позиции появляются из официальных документов партии (Этап 3+)."
              />
            }
          />
        </>
      )}
    </>
  );
}
