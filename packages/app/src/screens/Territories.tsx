import { useMemo, useState } from 'react';
import { Badge, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, GeoMap, GeoTree, GeoSearch } from '@yabloko/api-contract';
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
  const map = useApi(API.geoMap, MapEnvelope);
  const tree = useApi(API.geoTree, TreeEnvelope);

  const searchUrl = query.trim().length >= 2 ? `${API.geoSearch}?q=${encodeURIComponent(query.trim())}` : null;
  const search = useApi(searchUrl ?? API.geoSearch, SearchEnvelope);

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
            <GeoMapChart
              data={map.data}
              dark={theme === 'dark'}
              onPick={(geoId) => onNavigate(`territory/${geoId}`)}
              focusFd={focusFd}
            />
            <div className="small faint" style={{ marginTop: 10 }}>
              Методология слоя: {map.data.methodology}
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
