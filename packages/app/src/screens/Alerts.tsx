import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, AlertsList } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';
import { postJson } from '../api/client.js';

function severityTone(s: string): 'accent' | 'warn' | 'danger' {
  if (s === 'error') return 'danger';
  if (s === 'warn') return 'warn';
  return 'accent';
}

function typeHint(t: string): string {
  switch (t) {
    case 'SOURCE_FAILURE':
      return 'Источник не отвечает или все загрузки не удались';
    case 'NEW_PARTY_DOCUMENT':
      return 'Обнаружен новый документ партии (pipeline ingestion)';
    case 'NEW_PUBLICATION':
      return 'Новая публикация в медиа-мониторинге';
    case 'DATA_ANOMALY':
      return 'Статистическая аномалия в данных';
    case 'LEGAL_EVENT':
      return 'Событие правового мониторинга (ЦИК, суды, избиркомы)';
    default:
      return 'Системное событие';
  }
}

/**
 * Alert Center. Алерты строго системные (SOURCE_FAILURE, NEW_PARTY_DOCUMENT,
 * DATA_ANOMALY, …). Персональных алертов по частным лицам не существует.
 */
export function AlertsScreen() {
  const [openOnly, setOpenOnly] = useState(false);
  const state = useApi(openOnly ? `${API.alerts}?openOnly=true` : API.alerts, AlertsList);
  const [busy, setBusy] = useState<string | null>(null);

  const ack = async (alertId: string) => {
    setBusy(alertId);
    await postJson(API.alerts, { alert_id: alertId });
    setBusy(null);
    state.reload();
  };

  return (
    <>
      <div>
        <h2 className="section-title">ALERT CENTER</h2>
        <div className="section-sub">
          Системные события ingestion и данных. Персональных алертов по частным
          лицам не существует (архитектурный запрет).
        </div>
      </div>

      {state.status === 'loading' && <Skeleton h={140} />}
      {state.status === 'error' && (
        <ErrorBox message={state.error ?? 'Ошибка'} onRetry={state.reload} />
      )}
      {state.status === 'ready' && state.data && (
        <>
          <div className="row wrap">
            <Badge tone={state.data.openCount > 0 ? 'warn' : 'accent'}>
              Открытых: {state.data.openCount}
            </Badge>
            <Badge tone="muted">Всего: {state.data.alerts.length}</Badge>
            <div className="spacer" />
            <button className="btn small" onClick={() => setOpenOnly((v) => !v)}>
              {openOnly ? 'Показать все' : 'Только открытые'}
            </button>
          </div>

          {state.data.alerts.length === 0 && (
            <EmptyState
              title="Алертов нет"
              note="События появляются при работе ingestion (SOURCE_FAILURE, NEW_PARTY_DOCUMENT, DATA_ANOMALY и другие)."
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.data.alerts.map((a) => (
              <Panel key={a.alert_id} className={a.acknowledged_at ? '' : 'glow'}>
                <div className="row wrap">
                  <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                  <Badge tone="violet" title={typeHint(a.type)}>
                    {a.type}
                  </Badge>
                  <span className="small muted mono">{a.created_at}</span>
                  <div className="spacer" />
                  {!a.acknowledged_at && (
                    <button
                      className="btn small"
                      disabled={busy === a.alert_id}
                      onClick={() => ack(a.alert_id)}
                    >
                      Acknowledge
                    </button>
                  )}
                  {a.acknowledged_at && <Badge tone="muted">принят</Badge>}
                </div>
                <div style={{ marginTop: 8 }}>{a.title}</div>
                {a.payload_json && (
                  <details className="small faint" style={{ marginTop: 6 }}>
                    <summary>payload</summary>
                    <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                      {a.payload_json}
                    </pre>
                  </details>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}
    </>
  );
}
