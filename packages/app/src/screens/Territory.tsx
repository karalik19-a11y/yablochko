import { useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { MetricRow } from '@yabloko/ui';
import { API, Territory, TerritoryMetrics, TrustChain as TrustChainSchema, CivicOverview } from '@yabloko/api-contract';
import type { MetricView } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';
import { TrustBox } from '../components/TrustBox.js';

/**
 * Territory Profile: разделы из мастер-спецификации (DEMOGRAPHICS …
 * YABLOKO ACTIVITY). Разделы с метриками показывают значения+тренд+спарклайн
 * с provenance; разделы без данных — честный INSUFFICIENT DATA.
 */
export function TerritoryScreen({
  geoId,
  onNavigate
}: {
  geoId: string;
  onNavigate: (r: string) => void;
}) {
  const state = useApi(`${API.territory}/${encodeURIComponent(geoId)}`, Territory);
  const metrics = useApi(
    `${API.metricsTerritory}/${encodeURIComponent(geoId)}`,
    TerritoryMetrics
  );
  const [trustReq, setTrustReq] = useState<{ geo: string; code: string } | null>(null);
  const civic = useApi(
    `${API.civicOverview}?geo=${encodeURIComponent(geoId)}&months=12`,
    CivicOverview
  );
  const trust = useApi(
    trustReq
      ? `${API.metricsTrust}?geo=${encodeURIComponent(trustReq.geo)}&code=${encodeURIComponent(trustReq.code)}`
      : API.metricsTrust,
    TrustChainSchema
  );

  // Метрики по секциям профиля
  const bySection = useMemo(() => {
    const map = new Map<string, MetricView[]>();
    for (const d of metrics.data?.domains ?? []) {
      const arr = map.get(d.section) ?? [];
      arr.push(...d.metrics);
      map.set(d.section, arr);
    }
    return map;
  }, [metrics.data]);

  if (state.status === 'loading') return <Skeleton h={220} />;
  if (state.status === 'error') {
    return (
      <ErrorBox
        message={`Профиль территории недоступен: ${state.error}`}
        onRetry={state.reload}
      />
    );
  }
  if (!state.data) {
    return <EmptyState title="Территория не найдена" note={geoId} />;
  }
  const t = state.data;


  return (
    <>
      <div className="row wrap small muted">
        {t.path.map((p, i) => (
          <span key={p.geo_id} className="row" style={{ gap: 6 }}>
            {i > 0 && <span className="faint">→</span>}
            {i === t.path.length - 1 ? (
              <strong style={{ color: 'var(--text)' }}>{p.name}</strong>
            ) : (
              <a
                href={`#/territory/${encodeURIComponent(p.geo_id)}`}
                style={{ color: 'var(--info)' }}
              >
                {p.name}
              </a>
            )}
          </span>
        ))}
      </div>

      <div>
        <h2 className="section-title">{t.node.name}</h2>
        <div className="section-sub">
          Territory Profile · уровень: <strong>{t.node.level}</strong>
          {t.node.official_code && (
            <>
              {' '}
              · код: <span className="mono">{t.node.official_code}</span>{' '}
              <span className="faint">({t.node.code_system})</span>
            </>
          )}
        </div>
      </div>

      <div className="row wrap">
        <Badge tone="violet">{t.node.geo_id}</Badge>
        {t.node.children_count !== undefined && t.node.children_count > 0 && (
          <Badge tone="info">Подчинённых: {t.node.children_count}</Badge>
        )}
        {metrics.status === 'ready' && metrics.data && (
          <Badge
            tone="warn"
            title="Показатели генерируются SYNTHETIC-генератором (ADR-0005); заменяются Росстатом при импорте"
          >
            METRICS: SYNTHETIC
          </Badge>
        )}
        {t.parent && (
          <button
            className="btn small"
            onClick={() => onNavigate(`territory/${encodeURIComponent(t.parent!.geo_id)}`)}
          >
            ↑ {t.parent.name}
          </button>
        )}
      </div>

      <Panel title={t.childLabel ?? 'Нижний уровень'}>
        {t.children.length === 0 ? (
          <EmptyState
            title="INSUFFICIENT DATA"
            note="Нижний уровень для этой территории пока не загружен (пилотный охват муниципального слоя)."
            badge={<Badge tone="warn">ЭТАП 5+</Badge>}
          />
        ) : (
          <div className="row wrap">
            {t.children.map((c) => (
              <button
                key={c.geo_id}
                className="btn small"
                onClick={() => onNavigate(`territory/${encodeURIComponent(c.geo_id)}`)}
              >
                {c.name}
                {c.children_count ? <span className="faint"> · {c.children_count}</span> : null}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {metrics.status === 'loading' && <Skeleton h={160} />}
      {metrics.status === 'error' && (
        <ErrorBox message={`Показатели недоступны: ${metrics.error}`} onRetry={metrics.reload} />
      )}

      {t.sections.map((sec) => {
        if (sec.key === 'public_concerns' && civic.status === 'ready' && civic.data && civic.data.topics.length > 0) {
          const top5 = civic.data.topics.slice(0, 5);
          return (
            <Panel
              key={sec.key}
              title={sec.title}
              actions={
                <span className="small faint">
                  только агрегаты · k_min={civic.data.k_min} ·{' '}
                  <a href="#/civic-trends" style={{ color: 'var(--info)' }}>
                    CIVIC TRENDS →
                  </a>
                </span>
              }
            >
              {top5.map((c) => (
                <div
                  key={c.topic_id}
                  style={{ display: 'grid', gridTemplateColumns: '1.4fr auto auto auto', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="small" style={{ fontWeight: 600 }}>{c.topic_name}</span>
                  {c.insufficient ? (
                    <span className="badge muted" title={`last3 = ${c.last3_n} < k_min (${civic.data!.k_min})`}>
                      INSUFFICIENT DATA
                    </span>
                  ) : (
                    <span className="mono small">{c.last3_n.toLocaleString('ru-RU')} /3 мес</span>
                  )}
                  <span
                    className={`badge ${c.classification === 'rising' ? 'warn' : c.classification === 'declining' ? 'info' : c.classification === 'new' ? 'accent' : 'muted'}`}
                    title="Констатация изменения объёма last3 vs prev3, не оценка"
                  >
                    {c.classification.toUpperCase()}
                  </span>
                  <span className="small faint">
                    {c.growth_pct === null ? '—' : `${c.growth_pct > 0 ? '+' : ''}${c.growth_pct.toFixed(0)}%`}
                  </span>
                </div>
              ))}
              <div className="row wrap" style={{ marginTop: 8 }}>
                <span className="badge warn" title="SYNTHETIC-агрегаты (ADR-0005), не реальные сообщения">SYNTHETIC</span>
                <span className="small faint">Тональность и тексты сообщений не хранятся — только счётчики.</span>
              </div>
            </Panel>
          );
        }
        const ms = bySection.get(sec.title) ?? [];
        if (ms.length === 0) {
          return (
            <Panel key={sec.key} title={sec.title}>
              <EmptyState
                title="INSUFFICIENT DATA"
                note={sec.stage ? `Подключается на Этапе ${sec.stage}` : undefined}
              />
            </Panel>
          );
        }
        return (
          <Panel
            key={sec.key}
            title={sec.title}
            actions={
              <span className="small faint">
                каждая метрика: источник · методология · покрытие (кнопка Trust)
              </span>
            }
          >
            {ms.map((m) => (
              <MetricRow
                key={m.code}
                name={m.name}
                unit={m.unit}
                value={m.latest?.value ?? null}
                trendPct={m.trend_pct}
                trendAbs={m.trend_abs}
                series={m.series.map((s) => s.value)}
                dataMode={m.provenance.data_mode}
                onTrust={() => setTrustReq({ geo: geoId, code: m.code })}
              />
            ))}
          </Panel>
        );
      })}

      {trustReq && trust.status === 'ready' && trust.data && (
        <Panel
          title={`Why should I trust this? — ${trust.data.metric_name}`}
          actions={
            <button className="btn small" onClick={() => setTrustReq(null)}>
              Закрыть
            </button>
          }
        >
          <TrustBox chain={trust.data} label="Свернуть" />
        </Panel>
      )}
    </>
  );
}
