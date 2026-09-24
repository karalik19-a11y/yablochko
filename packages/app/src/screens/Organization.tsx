import { useState } from 'react';
import {
  Badge,
  ConfidenceBadge,
  DataTable,
  EmptyState,
  ErrorBox,
  Panel,
  PrecisionDate,
  Skeleton,
  VerificationBadge
} from '@yabloko/ui';
import {
  API,
  PartyBody,
  PartyDocument,
  PartyEvent,
  PartyLeader,
  ElectionParticipation
} from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

const EnvelopeOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item) });

type Tab = 'people' | 'documents' | 'candidates';

export function OrganizationScreen() {
  const [tab, setTab] = useState<Tab>('people');

  const leaders = useApi(API.partyLeaders, EnvelopeOf(PartyLeader));
  const bodies = useApi(API.partyBodies, EnvelopeOf(PartyBody));
  const documents = useApi(API.partyDocuments, EnvelopeOf(PartyDocument));
  const events = useApi(API.partyEvents, EnvelopeOf(PartyEvent));
  const participation = useApi(
    API.electionParticipation,
    EnvelopeOf(ElectionParticipation)
  );

  return (
    <>
      <div>
        <h2 className="section-title">ORGANIZATION — YABLOKO</h2>
        <div className="section-sub">
          Официальная структура партии и партийные документы. Все записи —
          из INITIAL CONTEXT (UNVERIFIED) до подключения Yabloko Source Layer.
        </div>
      </div>

      <div className="row">
        {(
          [
            ['people', 'Руководство и органы'],
            ['documents', 'Документы'],
            ['candidates', 'Кандидаты и выборы']
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={`btn small ${tab === key ? 'primary' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'people' && (
        <div className="grid-2">
          <Panel title="Руководство (PartyLeader)">
            {leaders.status === 'loading' && <Skeleton h={120} />}
            {leaders.status === 'error' && (
              <ErrorBox message={leaders.error ?? 'Ошибка'} onRetry={leaders.reload} />
            )}
            {leaders.status === 'ready' &&
              leaders.data &&
              leaders.data.items.map((l) => (
                <div key={l.leader_id} style={{ marginBottom: 12 }}>
                  <div className="row wrap">
                    <strong>{l.person_name}</strong>
                    <span className="muted">— {l.role_title}</span>
                    <ConfidenceBadge confidence={l.confidence} />
                    <VerificationBadge status={l.verification_status} />
                  </div>
                  {l.body_name && <div className="small faint">Орган: {l.body_name}</div>}
                  <div className="small faint">{l.date_note ?? `${l.date_from ?? '?'} — ${l.date_to ?? 'настоящее время'}`}</div>
                </div>
              ))}
          </Panel>

          <Panel title="Органы партии (PartyBody)">
            {bodies.status === 'loading' && <Skeleton h={120} />}
            {bodies.status === 'error' && (
              <ErrorBox message={bodies.error ?? 'Ошибка'} onRetry={bodies.reload} />
            )}
            {bodies.status === 'ready' &&
              bodies.data &&
              bodies.data.items.map((b) => (
                <div key={b.body_id} style={{ marginBottom: 12 }}>
                  <div className="row wrap">
                    <strong className="small">{b.name}</strong>
                    <Badge tone="violet">{b.body_type}</Badge>
                    <VerificationBadge status={b.verification_status} />
                  </div>
                  {b.description && <div className="small muted">{b.description}</div>}
                </div>
              ))}
            <hr className="divider" />
            <Panel title="События (PartyEvent)">
              {events.status === 'ready' &&
                events.data &&
                events.data.items.map((e) => (
                  <div key={e.event_id} style={{ marginBottom: 8 }}>
                    <div className="small">
                      <strong>{e.title}</strong>{' '}
                      <PrecisionDate date={e.event_date} precision={e.date_precision} />
                    </div>
                    {e.description && <div className="small faint">{e.description}</div>}
                  </div>
                ))}
            </Panel>
          </Panel>
        </div>
      )}

      {tab === 'documents' && (
        <DataTable
          rows={documents.status === 'ready' && documents.data ? documents.data.items : []}
          columns={[
            {
              key: 'title',
              header: 'Документ',
              render: (d) => (
                <div>
                  <strong className="small">{d.title}</strong>
                  {d.summary && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {d.summary}
                    </div>
                  )}
                </div>
              )
            },
            {
              key: 'type',
              header: 'Тип',
              width: '160px',
              render: (d) => <Badge tone="violet">{d.doc_type}</Badge>
            },
            {
              key: 'date',
              header: 'Дата',
              width: '200px',
              render: (d) => (
                <span className="small">
                  <PrecisionDate date={d.doc_date} precision={d.date_precision} />
                </span>
              )
            },
            {
              key: 'verification',
              header: 'Верификация',
              width: '120px',
              render: (d) => <VerificationBadge status={d.verification_status} />
            },
            {
              key: 'source',
              header: 'Источник',
              width: '200px',
              render: (d) => <span className="source-ref">{d.source_name ?? d.source_id}</span>
            }
          ]}
          empty={
            documents.status === 'loading' ? (
              <Skeleton h={120} />
            ) : (
              <EmptyState title="Документы не найдены" />
            )
          }
        />
      )}

      {tab === 'candidates' && (
        <>
          <EmptyState
            title="Кандидаты: INSUFFICIENT DATA"
            note="В INITIAL CONTEXT нет данных о кандидатах. База кандидатов создаётся на Этапе 8 из официальных источников (ЦИК, избиркомы, партийные документы). Система не заполняет пустоту вымышленными данными."
            badge={<Badge tone="warn">ЭТАП 8</Badge>}
          />
          {participation.status === 'ready' && participation.data && participation.data.items.length === 0 && (
            <EmptyState
              title="Участие в выборах: INSUFFICIENT DATA"
              note="Исторические данные об участии партии в выборах будут импортированы с обязательным official_source для каждого результата."
              badge={<Badge tone="warn">ЭТАП 8</Badge>}
            />
          )}
        </>
      )}
    </>
  );
}
