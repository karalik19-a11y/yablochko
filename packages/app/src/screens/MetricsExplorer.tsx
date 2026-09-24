import { useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import {
  API,
  MetricsCatalog,
  CompareData,
  GeoTree,
  TrustChain as TrustChainSchema
} from '@yabloko/api-contract';
import type { MetricCatalogEntry, TrustChain } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';
import { TrustBox } from '../components/TrustBox.js';

/**
 * Общий экран сравнения территорий по показателям (Population / Economy /
 * Society различаются набором доменов). Таблица с сортировкой + фильтр ФО +
 * кнопка Trust («Why should I trust this?»).
 */
export function MetricsExplorer({
  title,
  description,
  domains
}: {
  title: string;
  description: string;
  domains: string[];
}) {
  const catalog = useApi(API.metricsCatalog, MetricsCatalog);
  const tree = useApi(API.geoTree, GeoTree);

  const available = useMemo(() => {
    const c = catalog.data;
    if (!c) return [] as MetricCatalogEntry[];
    return c.metrics.filter((m) => domains.includes(m.domain));
  }, [catalog.data, domains]);

  const [selected, setSelected] = useState<string[]>([]);
  const [fd, setFd] = useState<string>('');
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [trust, setTrust] = useState<{ geo: string; code: string } | null>(null);

  const effectiveCodes = useMemo(() => {
    const sel = selected.filter((c) => available.some((a) => a.code === c));
    return sel.length > 0 ? sel : available.slice(0, 3).map((a) => a.code);
  }, [selected, available]);

  const url = `${API.metricsCompare}?codes=${effectiveCodes.join(',')}${fd ? `&fd=${encodeURIComponent(fd)}` : ''}`;
  const compare = useApi(url, CompareData);

  const unitOf = (code: string) =>
    available.find((a) => a.code === code)?.unit ??
    compare.data?.rows.find((r) => r.values[code] != null)?.units[code] ??
    '';

  const sortedRows = useMemo(() => {
    const rows = [...(compare.data?.rows ?? [])];
    if (sortBy) {
      rows.sort((a, b) => (b.values[sortBy] ?? -Infinity) - (a.values[sortBy] ?? -Infinity));
    }
    return rows;
  }, [compare.data, sortBy]);

  const toggle = (code: string) => {
    setSelected((s) => {
      if (s.includes(code)) return s.filter((c) => c !== code);
      if (s.length >= 4) return [...s.slice(1), code];
      return [...s, code];
    });
  };

  return (
    <>
      <div>
        <h2 className="section-title">{title}</h2>
        <div className="section-sub">{description}</div>
      </div>

      {catalog.status === 'loading' && <Skeleton h={80} />}
      {catalog.status === 'error' && (
        <ErrorBox message={`Каталог метрик недоступен: ${catalog.error}`} onRetry={catalog.reload} />
      )}

      {catalog.status === 'ready' && catalog.data && (
        <>
          <Panel
            title="Показатели (до 4)"
            actions={
              <Badge
                tone="warn"
                title="Все значения — детерминированный SYNTHETIC-генератор (ADR-0005); заменяются данными Росстата при импорте (CI/локально)"
              >
                SYNTHETIC DATA
              </Badge>
            }
          >
            <div className="row wrap">
              {available.map((m) => (
                <button
                  key={m.code}
                  className={`btn small ${effectiveCodes.includes(m.code) ? 'primary' : ''}`}
                  onClick={() => toggle(m.code)}
                  title={`${m.name} (${m.unit})`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <span className="small faint">Округ:</span>
              <button className={`btn small ${fd === '' ? 'primary' : ''}`} onClick={() => setFd('')}>
                Все
              </button>
              {tree.status === 'ready' &&
                tree.data &&
                tree.data.districts.map((d) => (
                  <button
                    key={d.geo_id}
                    className={`btn small ${fd === d.geo_id ? 'primary' : ''}`}
                    onClick={() => setFd(fd === d.geo_id ? '' : d.geo_id)}
                  >
                    {d.short_name}
                  </button>
                ))}
            </div>
          </Panel>

          {compare.status === 'loading' && <Skeleton h={240} />}
          {compare.status === 'error' && (
            <ErrorBox message={`Сравнение недоступно: ${compare.error}`} onRetry={compare.reload} />
          )}
          {compare.status === 'ready' && compare.data && (
            <Panel
              title={`Субъекты · период ${compare.data.period}`}
              actions={
                <span className="small faint">
                  клик по заголовку — сортировка · «Trust» — цепочка доказательств
                </span>
              }
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Субъект</th>
                      <th>ФО</th>
                      {compare.data.codes.map((c) => (
                        <th
                          key={c}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSortBy(sortBy === c ? null : c)}
                        >
                          {available.find((a) => a.code === c)?.name ?? c}
                          <span className="faint"> {unitOf(c)}</span>
                          {sortBy === c ? ' ↓' : ''}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.geo_id}>
                        <td>
                          <a
                            href={`#/territory/${encodeURIComponent(r.geo_id)}`}
                            style={{ color: 'var(--info)' }}
                          >
                            {r.name}
                          </a>
                        </td>
                        <td className="faint small">{r.fd_name ?? '—'}</td>
                        {compare.data!.codes.map((c) => {
                          const v = r.values[c];
                          return (
                            <td key={c} className="mono">
                              {v === null || v === undefined
                                ? '—'
                                : Math.abs(v) >= 1_000_000
                                  ? (v / 1_000_000).toFixed(2) + ' млн'
                                  : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                            </td>
                          );
                        })}
                        <td>
                          <button
                            className="btn small"
                            onClick={() =>
                              setTrust({ geo: r.geo_id, code: compare.data!.codes[0] ?? '' })
                            }
                          >
                            Trust
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedRows.length === 0 && (
                <EmptyState
                  title="INSUFFICIENT DATA"
                  note="По выбранным показателям нет загруженных значений."
                />
              )}
            </Panel>
          )}

          {trust && (
            <TrustPanel geo={trust.geo} code={trust.code} onClose={() => setTrust(null)} />
          )}
        </>
      )}
    </>
  );
}

function TrustPanel({ geo, code, onClose }: { geo: string; code: string; onClose: () => void }) {
  const state = useApi(
    `${API.metricsTrust}?geo=${encodeURIComponent(geo)}&code=${encodeURIComponent(code)}`,
    TrustChainSchema
  );
  return (
    <Panel
      title="Why should I trust this? — цепочка доказательств"
      actions={
        <button className="btn small" onClick={onClose}>
          Закрыть
        </button>
      }
    >
      {state.status === 'loading' && <Skeleton h={120} />}
      {state.status === 'error' && (
        <ErrorBox message={state.error ?? 'Ошибка'} onRetry={state.reload} />
      )}
      {state.status === 'ready' && state.data && (
        <TrustBox chain={state.data as TrustChain} label="Показать цепочку" />
      )}
    </Panel>
  );
}
