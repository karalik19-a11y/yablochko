import { useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, OsintGraph, OsintProfile, OsintSearchResults } from '@yabloko/api-contract';
import type { OsintEntity } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * OSINT (Этап 10): граф ПУБЛИЧНЫХ сущностей. Только публичные фигуры с
 * явной публичной ролью; приватные лица не вносятся (CHECK в схеме).
 * Каждое ребро несёт evidence; профиль — IDENTITY → AFFILIATIONS →
 * STATEMENTS → TIMELINE → SOURCES.
 */

const KIND_LABEL: Record<string, string> = {
  person: 'Публичная фигура',
  organization: 'Организация',
  company: 'Компания',
  media: 'СМИ'
};

const REL_LABEL: Record<string, string> = {
  works_at: 'работает в',
  member_of: 'член / руководитель',
  spoke_at: 'выступал на',
  published: 'опубликовал',
  mentioned: 'упомянут в',
  associated_with: 'связан с',
  participated_in: 'участвовал в'
};

/** Детерминированная раскладка графа: персоны слева, организации в центре, артефакты справа. */
function layout(g: NonNullable<ReturnType<typeof useApi<OsintGraph>>['data']>) {
  const pos = new Map<string, { x: number; y: number }>();
  const persons = g.entities.filter((e) => e.kind === 'person');
  const orgs = g.entities.filter((e) => e.kind === 'organization');
  const rest = g.entities.filter((e) => e.kind !== 'person' && e.kind !== 'organization');
  const artifacts = [...g.documents.map((d) => ({ id: d.document_id, label: d.title, kind: 'document' as const })), ...g.events.map((e) => ({ id: e.event_id, label: e.title, kind: 'event' as const }))];
  const colY = (i: number, n: number, h: number) => (n === 1 ? h / 2 : 30 + (i * (h - 60)) / (n - 1));
  persons.forEach((e, i) => pos.set(e.entity_id, { x: 110, y: colY(i, persons.length, 240) }));
  orgs.forEach((e, i) => pos.set(e.entity_id, { x: 300, y: colY(i, orgs.length, 240) }));
  rest.forEach((e, i) => pos.set(e.entity_id, { x: 300, y: colY(persons.length + i, persons.length + rest.length, 240) }));
  artifacts.forEach((a, i) => pos.set(a.id, { x: 500, y: colY(i, artifacts.length, 240) }));
  return { pos, artifacts };
}

function GraphView({ g, onPick }: { g: OsintGraph; onPick: (id: string) => void }) {
  const { pos, artifacts } = useMemo(() => layout(g), [g]);
  const nodeR = 26;
  return (
    <svg viewBox="0 0 620 260" style={{ width: '100%', maxWidth: 760, background: 'var(--bg-elev, transparent)' }} role="img" aria-label="Граф публичных сущностей">
      {/* рёбра */}
      {g.edges.map((e) => {
        const src = pos.get(e.src_entity_id);
        const dstId = e.dst_entity_id ?? e.dst_document_id ?? e.dst_event_id ?? e.dst_statement_id;
        const dst = dstId ? pos.get(dstId) : undefined;
        if (!src || !dst) return null;
        const mx = (src.x + dst.x) / 2;
        const my = (src.y + dst.y) / 2 - 6;
        return (
          <g key={e.edge_id}>
            <line x1={src.x} y1={src.y} x2={dst.x} y2={dst.y} stroke="var(--border)" strokeWidth={1.4} />
            <text x={mx} y={my} textAnchor="middle" fontSize={8.5} fill="var(--text-faint)">
              {REL_LABEL[e.relation] ?? e.relation}
            </text>
          </g>
        );
      })}
      {/* узлы-сущности */}
      {g.entities.map((e) => {
        const p = pos.get(e.entity_id);
        if (!p) return null;
        const fill = e.kind === 'person' ? '#8b6fc9' : e.kind === 'organization' ? 'var(--accent)' : 'var(--info)';
        return (
          <g key={e.entity_id} style={{ cursor: 'pointer' }} onClick={() => onPick(e.entity_id)}>
            <circle cx={p.x} cy={p.y} r={nodeR} fill={fill} opacity={0.85} />
            <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={9.5} fill="#fff" style={{ pointerEvents: 'none' }}>
              {e.name.split(' ')[0]?.slice(0, 7)}
            </text>
            <text x={p.x} y={p.y + nodeR + 12} textAnchor="middle" fontSize={9} fill="var(--text)">
              {e.name.length > 26 ? `${e.name.slice(0, 26)}…` : e.name}
            </text>
          </g>
        );
      })}
      {/* артефакты (документы/события) */}
      {artifacts.map((a) => {
        const p = pos.get(a.id);
        if (!p) return null;
        return (
          <g key={a.id}>
            <rect x={p.x - nodeR} y={p.y - nodeR + 6} width={nodeR * 2} height={nodeR * 2 - 12} rx={4} fill="var(--text-faint)" opacity={0.5} />
            <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={9} fill="var(--text)">
              {a.kind === 'document' ? 'док' : 'соб'}
            </text>
            <text x={p.x} y={p.y + nodeR + 8} textAnchor="middle" fontSize={8.5} fill="var(--text)">
              {a.label.length > 30 ? `${a.label.slice(0, 30)}…` : a.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ProfileView({ entityId, onBack }: { entityId: string; onBack: () => void }) {
  const state = useApi(`${API.osintEntity}?id=${encodeURIComponent(entityId)}`, OsintProfile);
  if (state.status === 'loading') return <Skeleton h={200} />;
  if (state.status === 'error') return <ErrorBox message={`Профиль недоступен: ${state.error}`} onRetry={state.reload} />;
  if (!state.data) return <EmptyState title="Сущность не найдена" />;
  const p = state.data;
  return (
    <Panel
      title={`${p.identity.name} — профиль публичной сущности`}
      actions={
        <button className="btn small" onClick={onBack}>
          ← К графу
        </button>
      }
    >
      {/* IDENTITY */}
      <div className="small faint">IDENTITY</div>
      <div className="row wrap" style={{ gap: 8, margin: '6px 0 12px' }}>
        <Badge tone="violet">{KIND_LABEL[p.identity.kind] ?? p.identity.kind}</Badge>
        {p.identity.public_role && <Badge tone="muted">{p.identity.public_role}</Badge>}
        <Badge tone={p.identity.verification_status === 'VERIFIED' ? 'accent' : 'warn'}>{p.identity.verification_status}</Badge>
        <span className="small faint">источник: {p.identity.source_name ?? p.identity.source_id}</span>
      </div>
      {p.identity.description && <div className="small" style={{ marginBottom: 12 }}>{p.identity.description}</div>}

      {/* AFFILIATIONS */}
      <div className="small faint">AFFILIATIONS</div>
      <div style={{ marginBottom: 12 }}>
        {p.affiliations.length === 0 ? (
          <EmptyState title="Связей не внесено" note="Каждая связь появляется только с evidence-источником." />
        ) : (
          p.affiliations.map((a, i) => (
            <div key={i} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{a.direction === 'out' ? '→' : '←'} {REL_LABEL[a.relation] ?? a.relation}</strong>{' '}
              {a.other_name ?? '—'}{' '}
              <Badge tone={a.confidence === 'HIGH' ? 'accent' : a.confidence === 'MEDIUM' ? 'muted' : 'warn'} title="Уверенность evidence">
                {a.confidence}
              </Badge>
              <div className="small faint">evidence: {a.evidence}</div>
              <div className="small faint">источник: {a.evidence_source_name ?? a.evidence_source_id}</div>
            </div>
          ))
        )}
      </div>

      {/* STATEMENTS */}
      <div className="small faint">STATEMENTS</div>
      <div style={{ marginBottom: 12 }}>
        {p.statements.length === 0 ? (
          <EmptyState title="Заявлений не внесено" note="Только categorized заявления (OFFICIAL PARTY STATEMENT / PUBLIC STATEMENT)." />
        ) : (
          p.statements.map((s) => (
            <div key={s.statement_id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <Badge tone={s.statement_category === 'OFFICIAL_PARTY_STATEMENT' ? 'violet' : 'muted'}>{s.statement_category}</Badge>{' '}
              {s.summary} <span className="faint">· {s.statement_date ?? 'дата неизвестна'}</span>
            </div>
          ))
        )}
      </div>

      {/* TIMELINE */}
      <div className="small faint">TIMELINE</div>
      <div style={{ marginBottom: 12 }}>
        {p.timeline.length === 0 ? (
          <EmptyState title="Событий не внесено" />
        ) : (
          p.timeline.map((t, i) => (
            <div key={i} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="mono faint">{t.date ?? '—'}</span> · <Badge tone="muted">{t.kind}</Badge> {t.title}
            </div>
          ))
        )}
      </div>

      {/* SOURCES */}
      <div className="small faint">SOURCES</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {p.sources.map((s) => (
          <Badge key={s.source_id} tone="info" title={`Использован в ${s.uses} местах профиля`}>
            {s.source_name ?? s.source_id} ×{s.uses}
          </Badge>
        ))}
      </div>
      <div className="small faint" style={{ marginTop: 10 }}>
        {p.privacy_note}
      </div>
    </Panel>
  );
}

export function OsintScreen({ initialEntityId }: { initialEntityId?: string } = {}) {
  const graph = useApi(API.osintGraph, OsintGraph);
  const [selected, setSelected] = useState<string | null>(initialEntityId ?? null);
  const [query, setQuery] = useState('');
  const search = useApi(`${API.osintSearch}?q=${encodeURIComponent(query)}`, OsintSearchResults);

  return (
    <>
      <div>
        <h2 className="section-title">OSINT — ГРАФ ПУБЛИЧНЫХ СУЩНОСТЕЙ</h2>
        <div className="section-sub">
          Публичные фигуры, организации и их связи — только с evidence-источником у каждого ребра. Приватные лица не
          вносятся архитектурно (CHECK в схеме): профили частных лиц, сторонников/противников и персональные
          электоральные оценки отсутствуют.
        </div>
      </div>

      {graph.status === 'loading' && <Skeleton h={240} />}
      {graph.status === 'error' && <ErrorBox message={`Граф недоступен: ${graph.error}`} onRetry={graph.reload} />}

      {graph.status === 'ready' && graph.data && (
        <>
          <div className="row wrap">
            <Badge tone="accent">Сущностей: {graph.data.entities.length}</Badge>
            <Badge tone="violet" title="Рёбра с доказательством (evidence source обязателен)">
              Рёбер с evidence: {graph.data.edges.length}
            </Badge>
            <Badge tone="warn" title="Все записи требуют подтверждения официальными источниками">
              UNVERIFIED
            </Badge>
          </div>

          {selected !== null ? (
            <ProfileView entityId={selected} onBack={() => setSelected(null)} />
          ) : (
            <>
              <Panel title="ГРАФ СВЯЗЕЙ">
                <GraphView g={graph.data} onPick={setSelected} />
                <div className="small faint" style={{ marginTop: 8 }}>
                  Нажмите на узел, чтобы открыть профиль (IDENTITY → AFFILIATIONS → STATEMENTS → TIMELINE → SOURCES).
                  {graph.data.methodology ? ` Methodology: ${graph.data.methodology}` : ''}
                </div>
              </Panel>

              <Panel title="СУЩНОСТИ">
                <div className="row wrap" style={{ marginBottom: 10 }}>
                  <input
                    className="input"
                    placeholder="Поиск по имени, роли, описанию…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ maxWidth: 320 }}
                  />
                </div>
                {query.trim() !== '' && search.status === 'ready' && (
                  <div className="small faint" style={{ marginBottom: 8 }}>
                    Найдено: {search.data !== null ? search.data.items.length : 0}
                  </div>
                )}
                {(query.trim() !== '' && search.status === 'ready' && search.data !== null
                  ? search.data.items
                  : graph.data.entities
                ).map(
                  (e: OsintEntity) => (
                    <div
                      key={e.entity_id}
                      style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}
                    >
                      <Badge tone={e.kind === 'person' ? 'violet' : e.kind === 'organization' ? 'accent' : 'info'}>
                        {KIND_LABEL[e.kind] ?? e.kind}
                      </Badge>
                      <span className="small">
                        <strong>{e.name}</strong>
                        {e.public_role && <span className="faint"> · {e.public_role}</span>}
                      </span>
                      <button className="btn small" onClick={() => setSelected(e.entity_id)}>
                        Профиль
                      </button>
                    </div>
                  )
                )}
                {query.trim() !== '' && search.status === 'ready' && search.data !== null && search.data.items.length === 0 && (
                  <EmptyState title="Ничего не найдено" note="Поиск ведётся только по публичным сущностям." />
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}
