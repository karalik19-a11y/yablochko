import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, PositionMatrix } from '@yabloko/api-contract';
import type { MatrixRow } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * POSITION MATRIX (Этап 7): позиция партии ↔ общественное мнение.
 * Категории жёстко разведены и никогда не смешиваются:
 *   ЗАЯВЛЕНИЕ ПАРТИИ — только из реестра;
 *   АНАЛИЗ — агрегаты настроений (тональность темы ≠ согласие с позицией);
 *   ФАКТ — региональные показатели;
 *   МОДЕЛЬ — сопоставление повестки по зафиксированным правилам.
 * Никаких политических рекомендаций.
 */

const COMP_BADGE: Record<MatrixRow['comparison']['status'], { text: string; tone: 'accent' | 'info' | 'muted'; title: string }> = {
  agenda_overlap: { text: 'AGENDA OVERLAP', tone: 'accent', title: 'Тема значима и есть актуальная документированная позиция' },
  agenda_divergence: { text: 'AGENDA DIVERGENCE', tone: 'info', title: 'Тема значима, документированной позиции в реестре нет' },
  uncertainty: { text: 'UNCERTAINTY', tone: 'muted', title: 'Недостаточно данных — совпадение не оценивается' }
};

function fmtVal(v: number, unit: string): string {
  const s =
    Math.abs(v) >= 1_000_000
      ? `${(v / 1_000_000).toFixed(2)} млн`
      : Math.abs(v) >= 10_000
        ? Math.round(v).toLocaleString('ru-RU')
        : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return `${s} ${unit}`;
}

function RowCard({ r }: { r: MatrixRow }) {
  const cb = COMP_BADGE[r.comparison.status];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '150px minmax(200px, 1.15fr) minmax(170px, 1fr) minmax(150px, 0.95fr) minmax(220px, 1.25fr)',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--border)',
        alignItems: 'start'
      }}
    >
      {/* Тема */}
      <div>
        <div className="small" style={{ fontWeight: 650 }}>
          {r.civic_topic_name}
        </div>
        {r.category && <div className="small faint">{r.category}</div>}
        {r.link_note && (
          <div className="small faint" title={r.link_note} style={{ marginTop: 4 }}>
            link: {r.link_note.length > 44 ? `${r.link_note.slice(0, 44)}…` : r.link_note}
          </div>
        )}
      </div>

      {/* Позиция партии — OFFICIAL PARTY STATEMENT */}
      <div>
        {r.position ? (
          <>
            <Badge tone="violet" title="Официальное заявление партии из реестра позиций; не факт и не мнение">
              ЗАЯВЛЕНИЕ ПАРТИИ
            </Badge>
            <div className="small" style={{ marginTop: 6 }}>
              «{r.position.exact_position}»
            </div>
            <div className="small faint" style={{ marginTop: 4 }}>
              с {r.position.date_from.slice(0, 4)} г. · {r.position.source_name ?? r.position.source_id}
              {r.position.party_document_title ? ` · ${r.position.party_document_title}` : ''}
            </div>
            <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
              <Badge tone={r.position.verification_status === 'VERIFIED' ? 'accent' : 'warn'}>
                {r.position.verification_status}
              </Badge>
              <Badge tone="muted" title="Уверенность извлечения позиции из документа">
                conf: {r.position.confidence}
              </Badge>
            </div>
          </>
        ) : (
          <div className="small faint" style={{ marginTop: 2 }}>
            Нет документированной позиции в реестре — блок честно пуст (ИИ не формулирует позиции).
          </div>
        )}
      </div>

      {/* Общественное мнение — ANALYSIS */}
      <div>
        {r.opinion ? (
          <>
            <Badge tone="warn" title="Агрегаты настроений (SYNTHETIC); тональность темы — не согласие с позицией">
              АНАЛИЗ · SYN
            </Badge>
            {r.opinion.insufficient ? (
              <div className="small" style={{ marginTop: 6 }}>
                <Badge tone="muted" title={`last3 = ${r.opinion.last3_n} < k_min`}>
                  INSUFFICIENT DATA
                </Badge>
              </div>
            ) : (
              <div className="small" style={{ marginTop: 6 }}>
                n = <span className="mono">{r.opinion.last3_n.toLocaleString('ru-RU')}</span> /3 мес
                <div className="faint">
                  негатив {r.opinion.neg_share_pct?.toFixed(0) ?? '—'}% · позитив {r.opinion.pos_share_pct?.toFixed(0) ?? '—'}%
                  · вопросов {r.opinion.questions.toLocaleString('ru-RU')}
                </div>
              </div>
            )}
            <div className="small faint" style={{ marginTop: 4 }}>
              тренд темы: {r.opinion.classification}
              {r.opinion.growth_pct !== null ? ` (${r.opinion.growth_pct > 0 ? '+' : ''}${r.opinion.growth_pct.toFixed(0)}%)` : ''} ·
              констатация, не оценка
            </div>
          </>
        ) : (
          <div className="small faint" style={{ marginTop: 2 }}>
            Нет данных настроений (INSUFFICIENT DATA).
          </div>
        )}
      </div>

      {/* Региональные данные — FACT */}
      <div>
        {r.regional.length > 0 ? (
          <>
            <Badge tone="info" title="Региональные показатели; SYNTHETIC до импорта официальной статистики">
              ФАКТ · SYN
            </Badge>
            <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
              {r.regional.slice(0, 3).map((m) => (
                <div className="small" key={m.metric_code} title={m.metric_name}>
                  {m.latest_value !== null ? (
                    <>
                      <span className="mono">{fmtVal(m.latest_value, '')}</span>{' '}
                      <span className="faint">{m.unit}</span>
                      {m.trend_pct !== null && (
                        <span className="faint"> ({m.trend_pct > 0 ? '+' : ''}{m.trend_pct.toFixed(1)}%)</span>
                      )}
                    </>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="small faint" style={{ marginTop: 2 }}>
            Связанного показателя в каталоге нет.
          </div>
        )}
      </div>

      {/* Сопоставление — MODEL */}
      <div>
        <Badge tone={cb.tone} title={cb.title}>
          {cb.text}
        </Badge>
        <div className="small" style={{ marginTop: 6 }}>
          {r.comparison.wording}
        </div>
      </div>
    </div>
  );
}

export function PositionMatrixView() {
  const url = `${API.positionsMatrix}?geo=${encodeURIComponent('ru:country:ru')}&months=12`;
  const state = useApi(url, PositionMatrix);

  if (state.status === 'loading') return <Skeleton h={220} />;
  if (state.status === 'error')
    return <ErrorBox message={`Матрица недоступна: ${state.error}`} onRetry={state.reload} />;
  if (!state.data) return <EmptyState title="Нет данных" />;

  const m = state.data;
  const count = (s: string) => m.rows.filter((r) => r.comparison.status === s).length;

  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="accent" title="Тема значима и есть актуальная документированная позиция">
          AGENDA OVERLAP: {count('agenda_overlap')}
        </Badge>
        <Badge tone="info" title="Тема значима, документированной позиции нет">
          AGENDA DIVERGENCE: {count('agenda_divergence')}
        </Badge>
        <Badge tone="muted" title="Недостаточно данных — не оценивается">
          UNCERTAINTY: {count('uncertainty')}
        </Badge>
        {m.unlinked_positions.length > 0 && (
          <Badge tone="violet" title="Позиции реестра без связи с темами настроений">
            Позиции без темы: {m.unlinked_positions.length} ({m.unlinked_positions.map((p) => p.topic).join(', ')})
          </Badge>
        )}
      </div>

      <Panel
        title={`Матрица «позиция ↔ мнение» — ${m.rows.length} тем`}
        actions={<span className="small faint">география: Россия · окно 12 мес · k_min={m.k_min}</span>}
      >
        <div
          className="small faint"
          style={{ display: 'grid', gridTemplateColumns: '150px minmax(200px, 1.15fr) minmax(170px, 1fr) minmax(150px, 0.95fr) minmax(220px, 1.25fr)', gap: 14, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}
        >
          <span>ТЕМА</span>
          <span>ЗАЯВЛЕНИЕ ПАРТИИ (реестр)</span>
          <span>ОБЩЕСТВЕННОЕ МНЕНИЕ (анализ)</span>
          <span>РЕГИОНАЛЬНЫЕ ДАННЫЕ (факт)</span>
          <span>СОПОСТАВЛЕНИЕ (модель)</span>
        </div>
        {m.rows.map((r) => (
          <RowCard key={r.civic_topic_id} r={r} />
        ))}
      </Panel>

      <Panel title="ПРАВИЛА СОПОСТАВЛЕНИЯ (МОДЕЛЬ)">
        <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
          {m.comparison_rules}
        </div>
        <ul className="small faint" style={{ marginTop: 8, paddingLeft: 18 }}>
          {m.category_rules.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <div className="small faint" style={{ marginTop: 6 }}>
          Methodology: {m.methodology}
        </div>
      </Panel>
    </>
  );
}
