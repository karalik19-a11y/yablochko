import {
  Badge,
  EmptyState,
  ErrorBox,
  KpiCard,
  OfficialStatement,
  Panel,
  PrecisionDate,
  Skeleton,
  VerificationBadge
} from '@yabloko/ui';
import { API, MetaStatus, PartyContext } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

export function OverviewScreen({ onNavigate }: { onNavigate: (r: string) => void }) {
  const meta = useApi(API.metaStatus, MetaStatus);
  const ctx = useApi(API.partyContext, PartyContext);

  return (
    <>
      {/* -------- RUSSIA OVERVIEW -------- */}
      <div>
        <h2 className="section-title">RUSSIA OVERVIEW</h2>
        <div className="section-sub">
          Целостная картина страны. Показатели появятся после подключения
          географии и статистики (Этапы 4–5).
        </div>
      </div>

      {meta.status === 'loading' && <Skeleton h={110} />}
      {meta.status === 'error' && (
        <ErrorBox message={`Системный статус недоступен: ${meta.error}`} onRetry={meta.reload} />
      )}
      {meta.status === 'ready' && meta.data && (
        <div className="grid-4 fade-in">
          <KpiCard
            label="Население"
            value="—"
            sub="Этап 5: Росстат (source: rosstat)"
          />
          <KpiCard
            label="Экономика"
            value="—"
            sub="Этап 5: regional_metrics"
          />
          <KpiCard
            label="Общественные проблемы"
            value="—"
            sub="Этап 6: Civic Intelligence"
          />
          <KpiCard
            label="Источники данных"
            value={`${meta.data.sources.active} / ${meta.data.sources.total}`}
            sub={`активных / всего · planned: ${meta.data.sources.planned}`}
          />
        </div>
      )}

      <Panel title="Data freshness" actions={<Badge tone="info">каркас</Badge>}>
        {meta.status === 'ready' && meta.data ? (
          <div className="small muted">
            Режим данных: <strong>{meta.data.dataMode}</strong> · БД:{' '}
            <span className="mono">{meta.data.database.engine}</span> · миграций
            применено: {meta.data.database.migrationsApplied} · последний seed:{' '}
            {meta.data.database.lastSeedAt ?? '—'} · последняя проверка партийного
            источника:{' '}
            {meta.data.jobs.lastPartyContextRefresh
              ? `${meta.data.jobs.lastPartyContextRefresh.status} (${meta.data.jobs.lastPartyContextRefresh.startedAt})`
              : 'ещё не выполнялась'}
          </div>
        ) : (
          <Skeleton h={40} />
        )}
      </Panel>

      {/* -------- YABLOKO TODAY -------- */}
      <div>
        <h2 className="section-title">YABLOKO TODAY</h2>
        <div className="section-sub">
          Партийный контекст из Party Context Engine. Все партийные
          формулировки помечены как <strong>OFFICIAL PARTY STATEMENT</strong>;
          статус верификации всегда виден.
        </div>
      </div>

      {ctx.status === 'loading' && <Skeleton h={220} />}
      {ctx.status === 'error' && (
        <ErrorBox message={`Партийный контекст недоступен: ${ctx.error}`} onRetry={ctx.reload} />
      )}
      {ctx.status === 'ready' && ctx.data && (
        <>
          <div className="grid-2">
            <Panel title="Партия" glow>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{ctx.data.party.full_name}</div>
              <div className="row wrap" style={{ margin: '10px 0' }}>
                <VerificationBadge status={ctx.data.party.verification_status} />
                <Badge tone="violet">{ctx.data.party.source_name ?? ctx.data.party.source_id}</Badge>
              </div>
              <div className="small muted">{ctx.data.party.status_note}</div>
              <hr className="divider" />
              <div className="small muted">
                Позиций в реестре: {ctx.data.stats.positionsTotal} · актуальных:{' '}
                {ctx.data.stats.positionsCurrent} · не верифицировано:{' '}
                {ctx.data.stats.positionsUnverified} · конфликтов таймлайна:{' '}
                {ctx.data.stats.conflicts}
              </div>
            </Panel>

            <Panel title="Руководство и органы">
              {ctx.data.leaders.map((l) => (
                <div key={l.leader_id} style={{ marginBottom: 10 }}>
                  <div className="row wrap">
                    <strong>{l.person_name}</strong>
                    <span className="muted">— {l.role_title}</span>
                    <VerificationBadge status={l.verification_status} />
                  </div>
                  {l.body_name && <div className="small faint">Орган: {l.body_name}</div>}
                  {l.date_note && <div className="small faint">{l.date_note}</div>}
                </div>
              ))}
              <hr className="divider" />
              <div className="row wrap">
                {ctx.data.bodies.map((b) => (
                  <Badge key={b.body_id} tone="muted">
                    {b.name}
                  </Badge>
                ))}
              </div>
            </Panel>
          </div>

          <Panel
            title="Актуальные позиции (реестр)"
            actions={
              <button className="btn small" onClick={() => onNavigate('yabloko-position')}>
                Все позиции →
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ctx.data.currentPositions.length === 0 && (
                <EmptyState title="Нет действующих позиций" />
              )}
              {ctx.data.currentPositions.map((p) => (
                <div key={p.position_id}>
                  <div className="row wrap" style={{ marginBottom: 5 }}>
                    <strong className="small">{p.topic}</strong>
                    <VerificationBadge status={p.verification_status} />
                    <PrecisionDate date={p.date_from} precision={p.date_from_precision} />
                  </div>
                  <OfficialStatement text={p.exact_position} />
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid-2">
            <Panel title="Документы">
              {ctx.data.latestDocuments.map((d) => (
                <div key={d.doc_id} style={{ marginBottom: 10 }}>
                  <div className="row wrap">
                    <strong className="small">{d.title}</strong>
                    <VerificationBadge status={d.verification_status} />
                  </div>
                  <div className="small faint">
                    <PrecisionDate date={d.doc_date} precision={d.date_precision} /> ·{' '}
                    {d.source_name ?? d.source_id}
                  </div>
                </div>
              ))}
            </Panel>

            <Panel title="Кандидаты и выборы">
              <EmptyState
                title={`Кандидаты: ${ctx.data.candidates.count} · участие в выборах: ${ctx.data.electionParticipation.count}`}
                note={ctx.data.candidates.note || ctx.data.electionParticipation.note}
                badge={<Badge tone="warn">INSUFFICIENT DATA</Badge>}
              />
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
