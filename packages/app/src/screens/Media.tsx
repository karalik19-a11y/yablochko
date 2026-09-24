import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, MediaMentions, MediaTopicsSummary, MediaTrend, MediaSources } from '@yabloko/api-contract';
import type { MediaArticleRow } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * MEDIA (Этап 11): Yabloko Media Monitor. Панели MENTIONS / TOPICS /
 * SHARE & TREND / SOURCES / CONTEXT. «Show original sources» у каждой
 * публикации. ЗАПРЕТ ЯРЛЫКОВ БЕЗ МЕТОДОЛОГИИ: каждый sentiment-ярлык несёт
 * методологическую сноску (проверено схемой). SYNTHETIC-корпус: издания
 * фиктивные, не реальные СМИ.
 */

const CTX_BADGE: Record<string, { tone: 'accent' | 'muted' | 'info' | 'warn'; label: string }> = {
  positive: { tone: 'accent', label: 'позитивный' },
  neutral: { tone: 'muted', label: 'нейтральный' },
  negative: { tone: 'info', label: 'негативный' },
  unclear: { tone: 'warn', label: 'неясный' }
};

function ArticleRow({ a }: { a: MediaArticleRow }) {
  const [showSrc, setShowSrc] = useState(false);
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '86px 1fr auto auto', gap: 12, alignItems: 'start' }}>
        <span className="small mono faint">{a.published_at}</span>
        <div>
          <span className="small" style={{ fontWeight: 600 }}>
            {a.title}
          </span>
          <div className="small faint" style={{ marginTop: 2 }}>
            {a.outlet_name} · {a.outlet_kind}
            {a.author ? ` · ${a.author}` : ''}
            {a.topic_name ? ` · тема: ${a.topic_name}` : ''}
          </div>
        </div>
        {a.mentions_yabloko ? (
          a.mention_context && a.mention_context in CTX_BADGE ? (
            <span
              className={`badge ${CTX_BADGE[a.mention_context]!.tone}`}
              title={a.sentiment_methodology ?? undefined}
            >
              {CTX_BADGE[a.mention_context]!.label}
            </span>
          ) : (
            <span className="badge muted">упоминание</span>
          )
        ) : (
          <span className="faint small">без упоминания</span>
        )}
        <button className="btn small" onClick={() => setShowSrc((v) => !v)}>
          {showSrc ? 'Скрыть источник' : 'Show original sources'}
        </button>
      </div>
      {showSrc && (
        <div className="small faint" style={{ marginTop: 6, marginLeft: 98 }}>
          Источник: {a.outlet_name} (outlet_id: {a.outlet_id}) · dataset source: {a.source_id} · data_mode: {a.data_mode} ·
          статус: {a.verification_status}
          {a.url ? (
            <>
              {' '}
              ·{' '}
              <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>
                оригинал публикации
              </a>
            </>
          ) : (
            ' · URL появится при реальном импорте'
          )}
          {a.sentiment_methodology && (
            <div style={{ marginTop: 3 }}>
              Methodology: {a.sentiment_methodology}
            </div>
          )}
          {a.claim_note && <div style={{ marginTop: 3 }}>Claim: {a.claim_note}</div>}
        </div>
      )}
    </div>
  );
}

export function MediaScreen() {
  const [months, setMonths] = useState(12);
  const [topic, setTopic] = useState('');
  const [onlyMentions, setOnlyMentions] = useState(false);

  const mentionsUrl = `${API.mediaMentions}?months=${months}${topic ? `&topic=${topic}` : ''}${onlyMentions ? '&mentions=1' : ''}`;
  const mentions = useApi(mentionsUrl, MediaMentions);
  const topics = useApi(`${API.mediaTopics}?months=${months}`, MediaTopicsSummary);
  const trend = useApi(`${API.mediaTrend}?months=${months}`, MediaTrend);
  const sources = useApi(API.mediaSources, MediaSources);

  const maxShare = Math.max(...(trend.data?.points ?? []).map((p) => p.share_pct ?? 0), 10);

  return (
    <>
      <div>
        <h2 className="section-title">MEDIA — YABLOKO MEDIA MONITOR</h2>
        <div className="section-sub">
          Модель публикации: издание, дата, тема, упоминание «ЯБЛОКО», тональность с обязательной методологической
          сноской, claims. Ярлыки без методологии запрещены (проверяется схемой БД). SYNTHETIC-корпус: издания
          фиктивные («SYNTHETIC-ИЗДАНИЕ …»), не реальные СМИ — числа не являются рейтингами.
        </div>
      </div>

      <div className="row wrap">
        <span className="small faint">Окно:</span>
        {[6, 12, 21].map((m) => (
          <button key={m} className={`btn small ${months === m ? 'primary' : ''}`} onClick={() => setMonths(m)}>
            {m} мес
          </button>
        ))}
        <button className={`btn small ${onlyMentions ? 'primary' : ''}`} onClick={() => setOnlyMentions((v) => !v)}>
          Только упоминания «ЯБЛОКО»
        </button>
      </div>

      {mentions.status === 'loading' && <Skeleton h={200} />}
      {mentions.status === 'error' && (
        <ErrorBox message={`Публикации недоступны: ${mentions.error}`} onRetry={mentions.reload} />
      )}

      {mentions.status === 'ready' && mentions.data && (
        <Panel
          title="MENTIONS"
          actions={
            <div className="row wrap" style={{ gap: 6 }}>
              <Badge tone="warn" title="SYNTHETIC-корпус (grade D), заменяется реальным импортом">
                SYNTHETIC
              </Badge>
              <Badge tone="accent">Публикаций: {mentions.data.total}</Badge>
              <Badge tone="violet">С упоминанием: {mentions.data.mentions}</Badge>
            </div>
          }
        >
          {mentions.data.items.length === 0 ? (
            <EmptyState title="Публикаций не найдено" note="Измените фильтры или окно." />
          ) : (
            <>
              <div className="small faint" style={{ marginBottom: 8 }}>
                Тональность упоминаний (по методологии): позитивных {mentions.data.context_split.positive} · нейтральных{' '}
                {mentions.data.context_split.neutral} · негативных {mentions.data.context_split.negative} · неясных{' '}
                {mentions.data.context_split.unclear}
              </div>
              {mentions.data.items.slice(0, 40).map((a) => (
                <ArticleRow key={a.article_id} a={a} />
              ))}
              {mentions.data.items.length > 40 && (
                <div className="small faint" style={{ marginTop: 8 }}>
                  Показаны первые 40 из {mentions.data.items.length}. Уточните фильтры.
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {topics.status === 'ready' && topics.data && (
        <Panel title="TOPICS — публикации по темам">
          {topics.data.items.length === 0 ? (
            <EmptyState title="Нет данных за окно" />
          ) : (
            <div>
              {topics.data.items.map((t) => (
                <button
                  key={t.topic_id}
                  className="btn"
                  onClick={() => setTopic(topic === t.topic_id ? '' : t.topic_id)}
                  style={{ display: 'grid', gridTemplateColumns: '1.4fr auto auto auto', gap: 12, width: '100%', textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--border)' }}
                  title={`Фильтр MENTIONS по теме «${t.topic_name}»`}
                >
                  <span className="small" style={{ fontWeight: topic === t.topic_id ? 700 : 400 }}>
                    {t.topic_name}
                  </span>
                  <span className="mono small">{t.articles} публ.</span>
                  <span className="mono small">{t.mentions} упом.</span>
                  <span className="small faint">
                    негатив: {t.neg_share_pct !== null ? `${t.neg_share_pct.toFixed(0)}%` : '—'}
                    <span title={topics.data!.methodology}> ⓘ</span>
                  </span>
                </button>
              ))}
              <div className="small faint" style={{ marginTop: 8 }}>
                Methodology: {topics.data.methodology}
              </div>
            </div>
          )}
        </Panel>
      )}

      {trend.status === 'ready' && trend.data && (
        <Panel title="SHARE & TREND — доля публикаций с упоминанием «ЯБЛОКО»">
          {trend.data.points.length === 0 ? (
            <EmptyState title="Нет данных за окно" />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
                {trend.data.points.map((p) => (
                  <div key={p.period} style={{ textAlign: 'center', width: 42 }}>
                    <div
                      title={`${p.period}: ${p.mentions} из ${p.articles} публикаций (${(p.share_pct ?? 0).toFixed(1)}%)`}
                      style={{
                        height: `${Math.max(((p.share_pct ?? 0) / maxShare) * 90, 2)}px`,
                        background: 'var(--accent)',
                        opacity: 0.85,
                        margin: '0 auto',
                        width: 22
                      }}
                    />
                    <div className="small faint mono" style={{ marginTop: 3 }}>
                      {p.period.slice(2, 7)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="small faint" style={{ marginTop: 10 }}>
                Доля = публикации с упоминанием / все публикации месяца. Констатация присутствия в повестке, не оценка
                изданий и не причинность. Methodology: {trend.data.methodology}
              </div>
            </>
          )}
        </Panel>
      )}

      {sources.status === 'ready' && sources.data && (
        <>
          <Panel title="SOURCES — издания корпуса">
            <div>
              {sources.data.outlets.map((o) => (
                <div
                  key={o.outlet_id}
                  style={{ display: 'grid', gridTemplateColumns: '1.6fr auto auto auto', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}
                >
                  <span className="small">{o.name}</span>
                  <span className="small faint">{o.kind}</span>
                  <span className="mono small">{o.articles} публ.</span>
                  <span className="small">
                    {o.data_mode === 'SYNTHETIC' ? <Badge tone="warn">SYNTHETIC</Badge> : <Badge tone="accent">LIVE</Badge>}
                  </span>
                </div>
              ))}
            </div>
            <div className="small faint" style={{ marginTop: 8 }}>
              {sources.data.note}
            </div>
          </Panel>

          <Panel title="CONTEXT — claims и правила">
            <div style={{ marginBottom: 10 }}>
              {sources.data.claims.map((c) => (
                <div key={c.claim_id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <Badge tone={c.claim_category === 'party_statement' ? 'violet' : c.claim_category === 'external_claim' ? 'info' : 'warn'}>
                    {c.claim_category}
                  </Badge>{' '}
                  {c.claim_text}
                </div>
              ))}
            </div>
            <ul className="small faint" style={{ paddingLeft: 18 }}>
              <li>Ярлык тональности без методологической сноски невозможен — CHECK в схеме БД + тест.</li>
              <li>Не рейтинги и не оценки СМИ: доли упоминаний — констатация присутствия в повестке.</li>
              <li>Claims: party_statement сверяется с реестром позиций; external/unverified требуют верификации.</li>
              <li>«Show original sources» — издание, source_id и URL оригинала у каждой публикации.</li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
