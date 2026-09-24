import {
  Badge,
  DataTable,
  EmptyState,
  ErrorBox,
  Panel,
  Skeleton
} from '@yabloko/ui';
import { API, Source } from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

const SourcesEnvelope = z.object({ sources: z.array(Source) });

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="accent">ACTIVE</Badge>;
  if (status === 'failed') return <Badge tone="danger">FAILED</Badge>;
  if (status === 'retired') return <Badge tone="muted">RETIRED</Badge>;
  return <Badge tone="warn">PLANNED</Badge>;
}

export function SourcesScreen() {
  const state = useApi(API.sources, SourcesEnvelope);

  return (
    <>
      <div>
        <h2 className="section-title">SOURCE REGISTRY</h2>
        <div className="section-sub">
          Ни один источник не используется без метаданных и provenance.
          Приоритет: официальные государственные → ЦИК → Росстат → официальные
          документы партии → научные датасеты → опросы → СМИ. Полный ingestion
          pipeline — Этап 3.
        </div>
      </div>

      {state.status === 'loading' && <Skeleton h={200} />}
      {state.status === 'error' && (
        <ErrorBox message={`Реестр источников недоступен: ${state.error}`} onRetry={state.reload} />
      )}
      {state.status === 'ready' && state.data && (
        <>
          <Panel title="Yabloko Source Layer">
            <div className="small muted">
              Официальные партийные источники (yabloko.ru, региональные сайты,
              документы ФПК и Бюро) образуют отдельный приоритетный слой.
              Коннектор <span className="mono">party-context-refresh</span>{' '}
              проверяет их доступность по расписанию (Этап 3 расширит до полного
              pipeline DISCOVER → … → INDEX).
            </div>
          </Panel>

          <DataTable
            rows={state.data.sources}
            columns={[
              {
                key: 'name',
                header: 'Источник',
                render: (s) => (
                  <div>
                    <strong className="small">{s.name}</strong>
                    {s.url && (
                      <div className="small faint mono" style={{ marginTop: 2 }}>
                        {s.url}
                      </div>
                    )}
                    {s.coverage && <div className="small muted" style={{ marginTop: 2 }}>{s.coverage}</div>}
                  </div>
                )
              },
              {
                key: 'type',
                header: 'Тип / владелец',
                width: '210px',
                render: (s) => (
                  <div className="small">
                    <Badge tone="violet">{s.source_type}</Badge>
                    <div className="faint" style={{ marginTop: 4 }}>
                      {s.owner ?? '—'}
                    </div>
                  </div>
                )
              },
              {
                key: 'reliability',
                header: 'Надёжность',
                width: '130px',
                render: (s) => (
                  <Badge
                    tone={s.reliability.grade.startsWith('A') ? 'accent' : s.reliability.grade.startsWith('B') ? 'info' : 'warn'}
                    title={s.reliability.note}
                  >
                    {s.reliability.grade}
                  </Badge>
                )
              },
              {
                key: 'freq',
                header: 'Обновление',
                width: '120px',
                render: (s) => <span className="small muted">{s.update_frequency ?? '—'}</span>
              },
              {
                key: 'status',
                header: 'Статус',
                width: '110px',
                render: (s) => <StatusBadge status={s.status} />
              },
              {
                key: 'policy',
                header: 'Политика',
                width: '260px',
                render: (s) => <span className="small faint">{s.update_policy ?? '—'}</span>
              }
            ]}
            empty={<EmptyState title="Источники не найдены" />}
          />
        </>
      )}
    </>
  );
}
