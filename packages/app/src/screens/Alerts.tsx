import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, MetaStatus } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * Каркас Alert Center. Типы алертов спецификации (NEW_PARTY_DOCUMENT,
 * SOURCE_FAILURE, …) появятся на Этапе 3 вместе с ingestion. Сейчас показываем
 * честное состояние: системные события из журнала задач.
 */
export function AlertsScreen() {
  const meta = useApi(API.metaStatus, MetaStatus);
  const job = meta.data?.jobs.lastPartyContextRefresh;

  return (
    <>
      <div>
        <h2 className="section-title">ALERT CENTER</h2>
        <div className="section-sub">
          Каркас. Алерты ingestion (SOURCE_FAILURE, NEW_PARTY_DOCUMENT,
          DATA_ANOMALY и др.) — с Этапа 3. Персональных алертов по частным лицам
          не будет никогда (архитектурный запрет).
        </div>
      </div>

      {meta.status === 'loading' && <Skeleton h={100} />}
      {meta.status === 'error' && (
        <ErrorBox message={meta.error ?? 'Ошибка'} onRetry={meta.reload} />
      )}
      {meta.status === 'ready' && (
        <Panel title="Системные события">
          {!job && (
            <EmptyState
              title="Событий пока нет"
              note="Фоновые задачи ещё не выполнялись в этой установке."
            />
          )}
          {job && (
            <div className="small">
              <div className="row wrap">
                <Badge
                  tone={
                    job.status === 'ok'
                      ? 'accent'
                      : job.status === 'network_unavailable' || job.status === 'timeout'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {job.status}
                </Badge>
                <span className="mono">party-context-refresh</span>
                <span className="faint">{job.startedAt}</span>
              </div>
              {job.detail && (
                <div className="muted" style={{ marginTop: 6 }}>
                  {job.detail}
                </div>
              )}
              <div className="faint" style={{ marginTop: 6 }}>
                В среде разработки без доступа к официальным источникам задача
                честно фиксирует недоступность сети — это состояние среды, а не
                сбой данных.
              </div>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
