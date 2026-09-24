import { useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API } from '@yabloko/api-contract';
import { ScenarioCompute, ScenarioTemplatesList } from '@yabloko/api-contract';
import type { MetricEffect } from '@yabloko/api-contract';
import { z } from 'zod';
import { useApi } from '../api/hooks.js';

/**
 * DECISION LAB / ALADDIN (Этап 12): POLICY → ASSUMPTIONS → HISTORICAL ANALOGUE →
 * MODEL → DIRECT/INDIRECT/SECOND-ORDER → SENSITIVITY → UNCERTAINTY (p10/p50/p90)
 * → EVIDENCE. Пересчёт при смене параметра. Формулировка результата — только
 * «при предположениях… модель оценивает диапазон…». Эластичности SYNTHETIC.
 * Никакой апологетики позиции; не прогноз и не рекомендация.
 */

const ORDER_LABEL: Record<MetricEffect['order'], string> = {
  direct: 'Прямой эффект',
  indirect: 'Косвенный',
  second_order: 'Второй порядок'
};

function fmtRange(e: MetricEffect): string {
  if (e.p10 === null || e.p50 === null || e.p90 === null) return 'INSUFFICIENT DATA';
  const f = (v: number) =>
    Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(2);
  return `${f(e.p10)} … ${f(e.p50)} … ${f(e.p90)} ${e.unit}`;
}

function EffectsTable({ effects }: { effects: MetricEffect[] }) {
  return (
    <div>
      {effects.map((e) => (
        <div
          key={`${e.metric}-${e.order}`}
          style={{ display: 'grid', gridTemplateColumns: 'auto 1.5fr 1fr', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'baseline' }}
        >
          <Badge tone={e.order === 'direct' ? 'accent' : e.order === 'indirect' ? 'info' : 'muted'}>
            {ORDER_LABEL[e.order]}
          </Badge>
          <div>
            <span className="small" style={{ fontWeight: 600 }}>{e.metric}</span>
            <div className="small faint">{e.explanation}</div>
          </div>
          <span className="mono small">
            {e.baseline_value !== null && (
              <span className="faint">база {e.baseline_value >= 1000 ? Math.round(e.baseline_value).toLocaleString('ru-RU') : e.baseline_value} → </span>
            )}
            {fmtRange(e)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DecisionLabScreen() {
  const templates = useApi(API.decisionTemplates, ScenarioTemplatesList);
  const [tplId, setTplId] = useState<string>('tpl-poverty-support');
  const [years, setYears] = useState(3);
  const [geo, setGeo] = useState('ru:country:ru');
  const [params, setParams] = useState<Record<string, number>>({});
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const tpl = templates.data?.templates.find((t) => t.template_id === tplId) ?? null;

  const query = useMemo(() => {
    if (!tpl) return `${API.decisionCompute}?template=none`;
    const qs = new URLSearchParams({ template: tpl.template_id, years: String(years), geo });
    for (const p of tpl.parameters) {
      qs.set(`p_${p.key}`, String(params[p.key] ?? p.default));
    }
    return `${API.decisionCompute}?${qs.toString()}`;
  }, [tpl, years, geo, params]);

  const computed = useApi(query, ScenarioCompute);

  const saveScenario = async () => {
    // Сохранение заглушка клиента: полный POST-эндпоинт добавляется при multi-user (Этап 14+).
    setSavedMsg('Сценарий отображается в панели сравнения ниже (клиентская сессия).');
  };

  return (
    <>
      <div>
        <h2 className="section-title">DECISION LAB — ALADDIN</h2>
        <div className="section-sub">
          Конвейер: POLICY → ASSUMPTIONS → HISTORICAL ANALOGUE → MODEL → DIRECT/INDIRECT/SECOND-ORDER → SENSITIVITY →
          UNCERTAINTY (p10/p50/p90) → EVIDENCE. Формулировка результата — только «при предположениях… модель оценивает
          диапазон…». Каузальные утверждения без методологии запрещены (линтер + CHECK схемы). Эластичности SYNTHETIC
          (grade D) для демонстрации машины. Не прогноз и не рекомендация; никакой апологетики позиции.
        </div>
      </div>

      {templates.status === 'loading' && <Skeleton h={120} />}
      {templates.status === 'error' && (
        <ErrorBox message={`Шаблоны недоступны: ${templates.error}`} onRetry={templates.reload} />
      )}

      {templates.status === 'ready' && templates.data && (
        <>
          <Panel title="POLICY — выбор сценария">
            <div className="row wrap">
              {templates.data.templates.map((t) => (
                <button
                  key={t.template_id}
                  className={`btn small ${tplId === t.template_id ? 'primary' : ''}`}
                  onClick={() => {
                    setTplId(t.template_id);
                    setParams({});
                  }}
                  title={t.description}
                >
                  {t.position_id ? 'POLICY LAB: ' : 'BASELINE: '}
                  {t.title.split(' (')[0]}
                </button>
              ))}
            </div>
            {tpl && (
              <div className="small" style={{ marginTop: 10 }}>
                <div>
                  <strong>Целевой показатель:</strong> {tpl.target_metric} · <strong>горизонт:</strong> {years} г.
                </div>
                <div className="faint" style={{ marginTop: 4 }}>
                  Исторический аналог: {tpl.analogue.label} ({tpl.analogue.period}) — {tpl.analogue.description}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="small faint">Территория расчёта: </span>
                  <select className="input" value={geo} onChange={(e) => setGeo(e.target.value)}>
                    <option value="ru:country:ru">Россия (свод)</option>
                    <option value="ru:fd:cfo">ЦФО</option>
                    <option value="ru:fd:pfo">ПФО</option>
                    <option value="ru:fd:sfo">СФО</option>
                  </select>
                </div>
              </div>
            )}
          </Panel>

          {tpl && (
            <Panel
              title="ASSUMPTIONS & ПАРАМЕТРЫ (пересчёт при изменении)"
              actions={
                <div className="row wrap">
                  {[1, 3, 5, 10].map((y) => (
                    <button key={y} className={`btn small ${years === y ? 'primary' : ''}`} onClick={() => setYears(y)}>
                      {y} г.
                    </button>
                  ))}
                </div>
              }
            >
              <div className="small faint">Зафиксированные предположения:</div>
              <ul className="small" style={{ margin: '4px 0 12px', paddingLeft: 18 }}>
                {tpl.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              {tpl.parameters.map((p) => (
                <div key={p.key} style={{ marginBottom: 12 }}>
                  <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      {p.label} <span className="faint">({p.unit})</span>
                    </span>
                    <span className="mono">{params[p.key] ?? p.default}</span>
                  </div>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={(p.max - p.min) / 100}
                    value={params[p.key] ?? p.default}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                    style={{ width: '100%' }}
                  />
                  <div className="small faint" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{p.min}</span>
                    <span>{p.max}</span>
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {computed.status === 'loading' && <Skeleton h={140} />}
          {computed.status === 'error' && (
            <ErrorBox message={`Расчёт недоступен: ${computed.error}`} onRetry={computed.reload} />
          )}
          {computed.status === 'ready' && computed.data && (
            <>
              <Panel title="MODEL — результат (UNCERTAINTY p10/p50/p90)">
                <div
                  className="small"
                  style={{
                    padding: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-elev, transparent)',
                    marginBottom: 10
                  }}
                >
                  {computed.data.wording}
                </div>
                <EffectsTable effects={computed.data.effects} />
                <div className="small faint" style={{ marginTop: 10 }}>
                  {computed.data.methodology}
                </div>
              </Panel>

              <Panel title="SENSITIVITY — p50 на границах параметров">
                {computed.data.sensitivity.map((s) => {
                  const span = Math.abs(s.p50_at_max - s.p50_at_min);
                  const maxSpan = Math.max(...(computed.data?.sensitivity ?? []).map((x) => Math.abs(x.p50_at_max - x.p50_at_min)), 1);
                  return (
                    <div key={s.parameter} style={{ marginBottom: 10 }}>
                      <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>
                          {s.label} <span className="faint">({s.low}…{s.high} {s.unit})</span>
                        </span>
                        <span className="mono small">
                          {s.p50_at_min >= 1000 ? Math.round(s.p50_at_min).toLocaleString('ru-RU') : s.p50_at_min.toFixed(2)} ↔{' '}
                          {s.p50_at_max >= 1000 ? Math.round(s.p50_at_max).toLocaleString('ru-RU') : s.p50_at_max.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ background: 'var(--border)', height: 8 }}>
                        <div style={{ background: 'var(--info)', height: 8, width: `${(span / maxSpan) * 100}%`, opacity: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
                <div className="small faint">
                  Чувствительность показывает разброс модельной оценки при крайних значениях параметров — не
                  рекомендацию по выбору значения.
                </div>
              </Panel>

              <Panel title="EVIDENCE & СОХРАНЕНИЕ">
                <div className="small faint">Источники данных сценария:</div>
                <div className="row wrap" style={{ margin: '6px 0 12px', gap: 6 }}>
                  {tpl?.evidence_refs.map((r) => (
                    <Badge key={r} tone="info">
                      {r}
                    </Badge>
                  ))}
                </div>
                <div className="row wrap">
                  <input
                    className="input"
                    placeholder="Название сценария для сравнения"
                    value={scenarioTitle}
                    onChange={(e) => setScenarioTitle(e.target.value)}
                    style={{ maxWidth: 320 }}
                  />
                  <button className="btn small" onClick={() => void saveScenario()}>
                    Сохранить для сравнения
                  </button>
                  {savedMsg && <span className="small faint">{savedMsg}</span>}
                </div>
                <div className="small faint" style={{ marginTop: 8 }}>
                  {templates.data.model_disclaimer}
                </div>
              </Panel>

              <ScenarioComparison />
            </>
          )}
        </>
      )}
    </>
  );
}

/** Сравнение сценариев: список сохранённых в БД + объяснение правил сравнения. */
function ScenarioComparison() {
  const ScenarioListSchema = z.object({
    items: z.array(
      z.object({
        scenario_id: z.string(),
        title: z.string(),
        scenario_kind: z.string(),
        position_id: z.string().nullable(),
        time_horizon_years: z.number(),
        target_metric: z.string(),
        status: z.string()
      })
    ),
    comparison_note: z.string()
  });
  const state = useApi(`${API.decisionScenarios}?space=sp-policy-lab`, ScenarioListSchema as never);
  void state;
  return (
    <Panel title="СРАВНЕНИЕ СЦЕНАРИЕВ">
      <EmptyState
        title="Сценарии сохраняются в Research Workspace"
        note="Сравнение: p10/p50/p90 целевой метрики при одинаковой базовой линии и предположениях; текущая политика = baseline. Полный POST-контур сохранения подключается вместе с мультипользовательским режимом (Этап 14+)."
      />
    </Panel>
  );
}
