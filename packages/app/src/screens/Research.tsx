import { useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, PartyPosition as PartyPositionSchema, ScenarioTemplatesList } from '@yabloko/api-contract';
import type { PartyPosition, ScenarioTemplateInfo } from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

/**
 * RESEARCH — Yabloko Policy Lab (Этап 12). Цепочка:
 * CURRENT POSITION → ASSUMPTIONS → CURRENT STATE → EVIDENCE →
 * POTENTIAL EFFECTS → RISKS / UNCERTAINTY → ALTERNATIVES.
 * Позиции — только из Party Position Registry (OFFICIAL PARTY STATEMENT, UNVERIFIED).
 * Никакой апологетики: эффекты — модельные диапазоны «при предположениях…»,
 * альтернативы включают baseline (текущая политика) и отказ от вмешательства.
 */

const POSITION_BADGE: Record<string, { tone: 'accent' | 'warn' | 'muted' | 'info'; label: string }> = {
  CURRENT: { tone: 'accent', label: 'CURRENT' },
  UNVERIFIED: { tone: 'warn', label: 'UNVERIFIED' },
  SUPERSEDED: { tone: 'muted', label: 'SUPERSEDED' },
  EXPIRED: { tone: 'muted', label: 'EXPIRED' },
  FUTURE: { tone: 'info', label: 'FUTURE' }
};

function ChainStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div
        className="mono small"
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border)',
          borderRadius: '50%'
        }}
      >
        {n}
      </div>
      <div>
        <div className="small" style={{ fontWeight: 700, letterSpacing: '0.04em' }}>
          {title}
        </div>
        <div className="small" style={{ marginTop: 4 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ResearchScreen() {
  const PositionListSchema = z.object({ positions: z.array(PartyPositionSchema) });
  const positions = useApi(API.partyPositions, PositionListSchema);
  const templates = useApi(API.decisionTemplates, ScenarioTemplatesList);
  const [positionId, setPositionId] = useState<string | null>(null);

  const active = useMemo(
    () => (positions.data?.positions ?? []).filter((p) => p.current_status === 'CURRENT'),
    [positions.data]
  );

  const selected: PartyPosition | null =
    active.find((p) => p.position_id === positionId) ?? active[0] ?? null;

  // Шаблоны, привязанные к реестру (policy_lab); позиции без шаблона показывают «нет модельной привязки».
  const linkedTemplates = useMemo(() => {
    if (!selected || templates.status !== 'ready' || !templates.data) return [] as ScenarioTemplateInfo[];
    return templates.data.templates.filter((t) => t.position_id === selected.position_id);
  }, [selected, templates.status, templates.data]);

  return (
    <>
      <div>
        <h2 className="section-title">RESEARCH — YABLOKO POLICY LAB</h2>
        <div className="section-sub">
          Позиции — исключительно из Party Position Registry (OFFICIAL PARTY STATEMENT; статус UNVERIFIED до
          подтверждения официальным документом). Цепочка: CURRENT POSITION → ASSUMPTIONS → CURRENT STATE → EVIDENCE →
          POTENTIAL EFFECTS → RISKS → UNCERTAINTY → ALTERNATIVES. Эффекты — модельные диапазоны «при предположениях…»
          (SYNTHETIC-эластичности, grade D), не прогноз и не рекомендация. Никакой апологетики позиции: альтернативы
          включают сохранение текущей политики и отказ от вмешательства.
        </div>
      </div>

      {positions.status === 'loading' && <Skeleton h={120} />}
      {positions.status === 'error' && (
        <ErrorBox message={`Реестр позиций недоступен: ${positions.error}`} onRetry={positions.reload} />
      )}

      {positions.status === 'ready' && positions.data && (
        <>
          <Panel title="CURRENT POSITION — из реестра">
            <div className="row wrap">
              {active.map((p) => (
                <button
                  key={p.position_id}
                  className={`btn small ${selected?.position_id === p.position_id ? 'primary' : ''}`}
                  onClick={() => setPositionId(p.position_id)}
                  title={p.exact_position}
                >
                  {p.topic}
                </button>
              ))}
            </div>
            {selected && (
              <div className="small" style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone="accent">OFFICIAL PARTY STATEMENT</Badge>
                  <Badge tone="warn">{selected.verification_status}</Badge>
                  <Badge tone={POSITION_BADGE[selected.current_status]?.tone ?? 'muted'}>
                    {POSITION_BADGE[selected.current_status]?.label ?? selected.current_status}
                  </Badge>
                  <span className="faint mono">{selected.position_id}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <strong>{selected.topic}:</strong> {selected.exact_position}
                </div>
                <div className="faint" style={{ marginTop: 4 }}>
                  С {selected.date_from} ({selected.date_from_precision}) · источник: {selected.source_name ?? selected.source_id}
                  {selected.party_document_title ? ` · документ: ${selected.party_document_title}` : ''}
                  {' · '}уверенность: {selected.confidence}
                </div>
              </div>
            )}
            {active.length === 0 && <EmptyState title="Позиций в статусе CURRENT в реестре нет" />}
          </Panel>

          {selected && (
            <Panel title={`ЦЕПОЧКА ОБОСНОВАНИЯ — ${selected.topic}`}>
              <ChainStep n={1} title="CURRENT POSITION">
                {selected.exact_position}
                <div className="faint" style={{ marginTop: 2 }}>
                  Извлечено механически из официальных документов; AI позиции не формулировал.
                </div>
              </ChainStep>
              <ChainStep n={2} title="ASSUMPTIONS">
                {linkedTemplates.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {linkedTemplates.flatMap((t) =>
                      t.assumptions.map((a, i) => <li key={`${t.template_id}-${i}`}>{a}</li>)
                    )}
                  </ul>
                ) : (
                  <span className="faint">
                    Модельная привязка для этой позиции не задана — предположения не строятся, чтобы не изобретать их за
                    партией.
                  </span>
                )}
              </ChainStep>
              <ChainStep n={3} title="CURRENT STATE">
                {linkedTemplates.length > 0 ? (
                  <span>
                    Целевые показатели: {linkedTemplates.map((t) => t.target_metric).join(', ')} — базовые линии берутся
                    из regional_metrics последнего периода (раздел DECISION LAB — расчёт).
                  </span>
                ) : (
                  <span className="faint">Нет модельной привязки.</span>
                )}
              </ChainStep>
              <ChainStep n={4} title="EVIDENCE">
                {linkedTemplates.length > 0 ? (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {linkedTemplates.flatMap((t) => t.evidence_refs.map((r) => <Badge key={r} tone="info">{r}</Badge>))}
                  </div>
                ) : (
                  <span className="faint">Нет модельной привязки.</span>
                )}
              </ChainStep>
              <ChainStep n={5} title="POTENTIAL EFFECTS (модель, «при предположениях…»)">
                {linkedTemplates.length > 0 ? (
                  <span>
                    Диапазоны p10/p50/p90 по целевой и связанным метрикам — см. расчёт в DECISION LAB для шаблона{' '}
                    {linkedTemplates.map((t) => t.template_id).join(', ')}. Эластичности SYNTHETIC (grade D):
                    демонстрация машины, не причинность.
                  </span>
                ) : (
                  <span className="faint">
                    Оценка эффектов невозможна без явных предположений и методологии — не заполняется намеренно.
                  </span>
                )}
              </ChainStep>
              <ChainStep n={6} title="RISKS / UNCERTAINTY">
                Модельный разброс p10…p90 отражает неопределённость эластичностей и шока параметров; чувствительность к
                крайним значениям — в панели SENSITIVITY (DECISION LAB). Качество данных — grade D (SYNTHETIC).
              </ChainStep>
              <ChainStep n={7} title="ALTERNATIVES">
                Любой сценарий сравнивается с baseline «текущая политика» и опцией «отказ от вмешательства» (шаблон
                tpl-migration-baseline — пример сценария без партийной позиции). Сравнение — по диапазонам при
                одинаковой базовой линии; предпочтение позиции платформой не выражается.
              </ChainStep>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
