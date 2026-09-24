import {
  Badge,
  DataTable,
  EmptyState,
  ErrorBox,
  Panel,
  Skeleton
} from '@yabloko/ui';
import { API, Source, DocumentsPage } from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

const SourcesEnvelope = z.object({ sources: z.array(Source) });
const DocsEnvelope = DocumentsPage;

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="accent">ACTIVE</Badge>;
  if (status === 'failed') return <Badge tone="danger">FAILED</Badge>;
  if (status === 'retired') return <Badge tone="muted">RETIRED</Badge>;
  return <Badge tone="warn">PLANNED</Badge>;
}

function RunBadge({ run }: { run: Source['last_run'] }) {
  if (!run) return <span className="faint small">—</span>;
  const tone =
    run.status === 'ok' ? 'accent' : run.status === 'partial' ? 'warn' : 'danger';
  return (
    <Badge tone={tone} title={`${run.started_at} · ${run.detail ?? ''}`}>
      {run.status} · {run.mode}
    </Badge>
  );
}

export function SourcesScreen() {
  const state = useApi(API.sources, SourcesEnvelope);
  const docs = useApi(`${API.documents}?limit=20`, DocsEnvelope);

  return (
    <>
      <div>
        <h2 className="section-title">SOURCE REGISTRY</h2>
        <div className="section-sub">
          Ни один источник не используется без метаданных и provenance.
          Pipeline Этапа 3: DISCOVER → FETCH → VERIFY → PARSE → CLASSIFY →
          EXTRACT → VERSION → STORE → INDEX. Запуск: <span className="mono">npm run ingest</span>{' '}
          (fixture-режим в песочнице, live — в CI/локально).
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
              Коннектор <span className="mono">yabloko-ru</span> реализует полный
              pipeline с retry (экспоненциальная пауза), SSRF-защитой
              (allowlist хоста на каждом редиректе), дедупликацией по
              content_sha256 и версионированием документов. Fixture-снимки
              помечаются <span className="mono">fetch_mode=fixture</span> и не
              могут быть выданы за живые данные.
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
                  </div>
                )
              },
              {
                key: 'type',
                header: 'Тип',
                width: '150px',
                render: (s) => <Badge tone="violet">{s.source_type}</Badge>
              },
              {
                key: 'reliability',
                header: 'Надёжность',
                width: '110px',
                render: (s) => (
                  <Badge
                    tone={
                      s.reliability.grade.startsWith('A')
                        ? 'accent'
                        : s.reliability.grade.startsWith('B')
                          ? 'info'
                          : 'warn'
                    }
                    title={s.reliability.note}
                  >
                    {s.reliability.grade}
                  </Badge>
                )
              },
              {
                key: 'status',
                header: 'Статус',
                width: '100px',
                render: (s) => <StatusBadge status={s.status} />
              },
              {
                key: 'run',
                header: 'Последний запуск',
                width: '140px',
                render: (s) => <RunBadge run={s.last_run} />
              },
              {
                key: 'counters',
                header: 'Данные',
                width: '120px',
                render: (s) => (
                  <span className="small muted" title="документов / снимков">
                    {s.counters.documents} / {s.counters.snapshots}
                  </span>
                )
              },
              {
                key: 'checksum',
                header: 'Checksum',
                width: '130px',
                render: (s) => (
                  <span className="small faint mono" title={s.checksum ?? undefined}>
                    {s.checksum ? s.checksum.slice(0, 12) + '…' : '—'}
                  </span>
                )
              }
            ]}
            empty={<EmptyState title="Источники не найдены" />}
          />

          <h2 className="section-title" style={{ marginTop: 8 }}>
            Документы источников
          </h2>
          <div className="section-sub">
            Результаты ingestion с полным provenance: snapshot (HTTP-статус),
            checksum, версия. Поиск по полнотекстовому индексу —{' '}
            <span className="mono">/api/v1/documents/search?q=…</span>
          </div>

          {docs.status === 'loading' && <Skeleton h={120} />}
          {docs.status === 'ready' && docs.data && docs.data.items.length === 0 && (
            <EmptyState
              title="Документов ещё нет"
              note="Запустите ingestion: npm run ingest -- --mode fixture (или live при наличии сети)."
            />
          )}
          {docs.status === 'ready' && docs.data && docs.data.items.length > 0 && (
            <DataTable
              rows={docs.data.items}
              columns={[
                {
                  key: 'title',
                  header: 'Документ',
                  render: (d) => (
                    <div>
                      <strong className="small">{d.title ?? '(без заголовка)'}</strong>
                      <div className="small faint mono" style={{ marginTop: 2 }}>
                        {d.url}
                      </div>
                    </div>
                  )
                },
                {
                  key: 'source',
                  header: 'Источник',
                  width: '130px',
                  render: (d) => <span className="small muted">{d.source_id}</span>
                },
                {
                  key: 'kind',
                  header: 'Вид',
                  width: '120px',
                  render: (d) => <Badge tone="info">{d.doc_kind ?? '—'}</Badge>
                },
                {
                  key: 'version',
                  header: 'Версия',
                  width: '80px',
                  render: (d) => <span className="small mono">v{d.version}</span>
                },
                {
                  key: 'mode',
                  header: 'Режим',
                  width: '100px',
                  render: (d) =>
                    d.fetch_mode === 'fixture' ? (
                      <Badge tone="warn" title="Синтетический тест-снимок, не живые данные">
                        FIXTURE
                      </Badge>
                    ) : (
                      <Badge tone="accent">LIVE</Badge>
                    )
                },
                {
                  key: 'hash',
                  header: 'Checksum',
                  width: '140px',
                  render: (d) => (
                    <span className="small faint mono" title={d.content_hash ?? undefined}>
                      {d.content_hash ? d.content_hash.slice(0, 12) + '…' : '—'}
                    </span>
                  )
                }
              ]}
            />
          )}
        </>
      )}
    </>
  );
}
