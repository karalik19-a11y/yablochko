import { useMemo, useState } from 'react';
import { Badge, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, GeoMap, GeoTree, GeoSearch, MetricMapValues } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';
import { GeoMapChart } from '../components/GeoMapChart.js';

const MapEnvelope = GeoMap;
const TreeEnvelope = GeoTree;
const SearchEnvelope = GeoSearch;

/**
 * TERRITORIES: картограмма РФ + drill-down (Россия → ФО → субъект → муниципальный
 * уровень). Клик по ячейке открывает Territory Profile.
 */
export function TerritoriesScreen({
  theme,
  onNavigate
}: {
  theme: string;
  onNavigate: (r: string) => void;
}) {
  const [focusFd, setFocusFd] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [layerCode, setLayerCode] = useState<string>('');
  const map = useApi(API.geoMap, MapEnvelope);
  const tree = useApi(API.geoTree, TreeEnvelope);
  const layer = useApi(
    layerCode ? `${API.metricsMap}?code=${encodeURIComponent(layerCode)}` : API.metricsMap,
    MetricMapValues
  );
  const layerActive = layerCode !== '' && layer.status === 'ready' && layer.data !== null;

  const searchUrl = query.trim().length >= 2 ? `${API.geoSearch}?q=${encodeURIComponent(query.trim())}` : null;
  const search = useApi(searchUrl ?? API.geoSearch, SearchEnvelope);

  // Слой показателя: значения по geo_id + шкала цвета (квантили)
  const layerData = useMemo(() => {
    if (!layerActive || !layer.data || !map.data) return null;
    const byGeo = new Map(layer.data.values.map((v) => [v.geo_id, v.value]));
    const values = layer.data.values.map((v) => v.value).filter((v) => Number.isFinite(v));
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const stops = [q(0), q(0.25), q(0.5), q(0.75), q(1)];
    const isDark = theme === 'dark';
    const colors = isDark
      ? ['rgba(92,188,124,0.06)', 'rgba(92,188,124,0.22)', 'rgba(92,188,124,0.42)', 'rgba(92,188,124,0.62)', 'rgba(92,188,124,0.85)']
      : ['rgba(46,139,82,0.08)', 'rgba(46,139,82,0.24)', 'rgba(46,139,82,0.44)', 'rgba(46,139,82,0.64)', 'rgba(35,118,71,0.88)'];
    const expr: unknown[] = ['interpolate', ['linear'], ['to-number', ['get', 'value'], 0]];
    stops.forEach((s0, i) => {
      expr.push(s0, colors[i]);
    });
    const features = map.data.features.map((f) => ({
      ...f,
      properties: { ...f.properties, value: byGeo.get(f.properties.geo_id) ?? null }
    }));
    return { geo: { ...map.data, features }, expr, stops, unit: layer.data.unit, period: layer.data.period };
  }, [layerActive, layer.data, map.data, theme]);

  const fdName = useMemo(() => {
    if (!focusFd || !tree.data) return null;
    return tree.data.districts.find((d) => d.geo_id === focusFd)?.short_name ?? focusFd;
  }, [focusFd, tree.data]);

  return (
    <>
      <div>
        <h2 className="section-title">TERRITORIES</h2>
        <div className="section-sub">
          Россия → федеральный округ → субъект → муниципалитет → город → район.
          Клик по ячейке открывает профиль территории.
        </div>
      </div>

      <Panel
        title="Карта субъектов РФ"
        actions={
          <div className="row wrap">
            {(tree.data?.districts ?? []).map((fd) => (
              <button
                key={fd.geo_id}
                className={`btn small ${focusFd === fd.geo_id ? 'primary' : ''}`}
                onClick={() => setFocusFd((f) => (f === fd.geo_id ? null : fd.geo_id))}
                title={`${fd.name} · субъектов: ${fd.subjects}`}
              >
                {fd.short_name}
              </button>
            ))}
          </div>
        }
      >
        {map.status === 'loading' && <Skeleton h={460} />}
        {map.status === 'error' && (
          <ErrorBox message={`Карта недоступна: ${map.error}`} onRetry={map.reload} />
        )}
        {map.status === 'ready' && map.data && (
          <>
            <div className="row wrap" style={{ marginBottom: 10 }}>
              <span className="small faint">Слой:</span>
              <button
                className={`btn small ${layerCode === '' ? 'primary' : ''}`}
                onClick={() => setLayerCode('')}
              >
                Базовая
              </button>
              <button
                className={`btn small ${layerCode === 'pop_total' ? 'primary' : ''}`}
                onClick={() => setLayerCode('pop_total')}
                title="Population (SYNTHETIC до импорта Росстата)"
              >
                Population
              </button>
              <button
                className={`btn small ${layerCode === 'inc_avg_wage_month' ? 'primary' : ''}`}
                onClick={() => setLayerCode('inc_avg_wage_month')}
                title="Income: средняя зарплата (SYNTHETIC)"
              >
                Income
              </button>
              <button
                className={`btn small ${layerCode === 'labor_unemployment_rate' ? 'primary' : ''}`}
                onClick={() => setLayerCode('labor_unemployment_rate')}
                title="Employment: безработица (SYNTHETIC)"
              >
                Employment
              </button>
              <button
                className={`btn small ${layerCode === 'hou_per_capita_m2' ? 'primary' : ''}`}
                onClick={() => setLayerCode('hou_per_capita_m2')}
                title="Housing: жильё на душу (SYNTHETIC)"
              >
                Housing
              </button>
              {layerActive && layer.data && (
                <Badge
                  tone="warn"
                  title="Значения слоя — SYNTHETIC-генератор (ADR-0005)"
                >
                  {layer.data.name} · SYN · {layer.data.period}
                </Badge>
              )}
            </div>
            <GeoMapChart
              data={layerData ? layerData.geo : map.data}
              dark={theme === 'dark'}
              onPick={(geoId) => onNavigate(`territory/${geoId}`)}
              focusFd={focusFd}
              fillColorExpr={layerData ? layerData.expr : null}
              hoverValue={(p) =>
                layerActive && p.value !== null && p.value !== undefined
                  ? p.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (layerData?.unit ?? '')
                  : null
              }
            />
            {layerActive && layerData && (
              <div className="row wrap small muted" style={{ marginTop: 8 }}>
                <span className="faint">Шкала (квантили):</span>
                {layerData.stops.map((s0, i) => (
                  <span key={i} className="row" style={{ gap: 4 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 10,
                        borderRadius: 3,
                        border: '1px solid var(--border-strong)',
                        background:
                          theme === 'dark'
                            ? ['rgba(92,188,124,0.15)', 'rgba(92,188,124,0.3)', 'rgba(92,188,124,0.5)', 'rgba(92,188,124,0.7)', 'rgba(92,188,124,0.9)'][i]
                            : ['rgba(46,139,82,0.15)', 'rgba(46,139,82,0.3)', 'rgba(46,139,82,0.5)', 'rgba(46,139,82,0.7)', 'rgba(35,118,71,0.9)'][i]
                      }}
                    />
                    {s0.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
                  </span>
                ))}
              </div>
            )}
            <div className="small faint" style={{ marginTop: 10 }}>
              Методология слоя: {map.data.methodology}
              {layerActive && layer.data
                ? ` Слой «${layer.data.name}» (${layer.data.unit}, ${layer.data.period}): данные SYNTHETIC — при импорте Росстата слой пересчитывается автоматически.`
                : ''}
            </div>
            {fdName && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Фильтр: <strong>{fdName}</strong> (повторное нажатие сбрасывает)
              </div>
            )}
          </>
        )}
      </Panel>

      <div className="grid-2">
        <Panel title="Поиск территории">
          <input
            className="input"
            placeholder="Регион, город, район… (минимум 2 символа)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && search.status === 'ready' && search.data && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {search.data.items.length === 0 && (
                <div className="small faint">Ничего не найдено</div>
              )}
              {search.data.items.map((n) => (
                <div
                  key={n.geo_id}
                  className="cmdk-item"
                  onClick={() => onNavigate(`territory/${n.geo_id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onNavigate(`territory/${n.geo_id}`)}
                >
                  <Badge tone="muted">{n.level}</Badge>
                  <span>{n.name}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Покрытие геобазы">
          {tree.status === 'loading' && <Skeleton h={90} />}
          {tree.status === 'ready' && tree.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} className="small">
              <div className="row wrap">
                <Badge tone="accent">Субъектов: {tree.data.totalSubjects}</Badge>
                <Badge tone="info">ФО: {tree.data.districts.length}</Badge>
                <Badge tone="warn">Муниципальный уровень: {tree.data.totalMunicipal} (пилот)</Badge>
              </div>
              <div className="muted">
                Полный муниципальный слой (~20 тыс. МО) подключается импортом из официальных
                источников; отсутствующее — INSUFFICIENT DATA, не заглушки.
              </div>
              <div className="muted">
                Коды: ISO 3166-2:RU где присвоен; ОКТМО добавляется при импорте Росстата (Этап 5).
              </div>
            </div>
          )}
        </Panel>
      </div>

      {tree.status === 'ready' && tree.data && (
        <Panel title="Федеральные округа">
          <div className="row wrap">
            {tree.data.districts.map((fd) => (
              <button
                key={fd.geo_id}
                className="btn small"
                onClick={() => onNavigate(`territory/${fd.geo_id}`)}
              >
                {fd.short_name} · {fd.subjects}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
