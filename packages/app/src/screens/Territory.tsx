import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, Territory } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * Territory Profile: структура из мастер-спецификации (DEMOGRAPHICS …
 * YABLOKO ACTIVITY). До соответствующих этапов каждый раздел честно
 * показывает INSUFFICIENT DATA с указанием этапа и источника.
 */
export function TerritoryScreen({ geoId, onNavigate }: { geoId: string; onNavigate: (r: string) => void }) {
  const state = useApi(`${API.territory}/${encodeURIComponent(geoId)}`, Territory);

  if (state.status === 'loading') return <Skeleton h={220} />;
  if (state.status === 'error') {
    return <ErrorBox message={`Профиль территории недоступен: ${state.error}`} onRetry={state.reload} />;
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
            note="Нижний уровень для этой территории пока не загружен (пилотный охват муниципального слоя). Данные появятся из официальных источников."
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

      <div className="grid-3">
        {t.sections.map((sec) => (
          <Panel key={sec.key} title={sec.title}>
            <EmptyState
              title="INSUFFICIENT DATA"
              note={sec.stage ? `Подключается на Этапе ${sec.stage}` : undefined}
            />
          </Panel>
        ))}
      </div>
    </>
  );
}
