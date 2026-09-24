import { useState } from 'react';
import { Badge, EmptyState, ErrorBox, Panel, Skeleton, Sparkline } from '@yabloko/ui';
import { API, CivicOverview, GeoTree, Territory } from '@yabloko/api-contract';
import type { CivicTopicSeries } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

/**
 * CIVIC TRENDS (Этап 6): общественные настроения — ТОЛЬКО агрегаты.
 * Экран не показывает и не может показать отдельные сообщения: их нет
 * ни в схеме, ни в API. k-анонимность: при n < k_min — INSUFFICIENT DATA.
 * Классификация тренда — констатация изменения объёма, не оценка.
 */

const CLASS_LABEL: Record<
  CivicTopicSeries['classification'],
  { text: string; tone: 'accent' | 'warn' | 'info' | 'muted'; title: string }
> = {
  new: { text: 'NEW', tone: 'accent', title: 'Тема впервые активна в последних 3 месяцах окна' },
  rising: {
    text: 'RISING',
    tone: 'warn',
    title: 'Объём последних 3 месяцев ≥ +25% к предыдущим 3. Констатация изменения, не оценка'
  },
  declining: {
    text: 'DECLINING',
    tone: 'info',
    title: 'Объём последних 3 месяцев ≤ −25% к предыдущим 3. Констатация изменения, не оценка'
  },
  stable: { text: 'STABLE', tone: 'muted', title: 'Изменение объёма в пределах ±25% или недостаточно истории' }
};

function MixBar({ mix, n }: { mix: { pos: number; neu: number; neg: number; mixed: number; unclear: number }; n: number }) {
  if (n <= 0) return <span className="faint small">—</span>;
  const seg = (v: number, color: string, label: string) => (
    <div
      key={label}
      title={`${label}: ${v} (${Math.round((v / n) * 100)}%)`}
      style={{ width: `${(v / n) * 100}%`, background: color, height: 10 }}
    />
  );
  return (
    <div style={{ display: 'flex', width: 160, border: '1px solid var(--border)' }}>
      {seg(mix.neg, '#d06a5c', 'Негатив')}
      {seg(mix.mixed, '#c9a227', 'Смешанный')}
      {seg(mix.unclear, '#8a8f98', 'Неясный')}
      {seg(mix.neu, '#5b8db8', 'Нейтральный')}
      {seg(mix.pos, '#4f9d69', 'Позитивный')}
    </div>
  );
}

function TrendCell({ t }: { t: CivicTopicSeries }) {
  if (t.insufficient || t.growth_pct === null) return <span className="faint small">—</span>;
  const up = t.growth_pct > 0.05;
  const down = t.growth_pct < -0.05;
  const color = up ? 'var(--accent)' : down ? 'var(--info)' : 'var(--text-faint)';
  return (
    <span
      className="small mono"
      style={{ color }}
      title="last3 vs prev3 по объёму. Констатация изменения, не оценка и не причинность"
    >
      {up ? '▲' : down ? '▼' : '—'} {t.growth_pct > 0 ? '+' : ''}
      {t.growth_pct.toFixed(0)}%
    </span>
  );
}

function MonthlyBars({ t }: { t: CivicTopicSeries }) {
  const max = Math.max(...t.months.map((m) => m.n), 1);
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 64, flexWrap: 'wrap' }}>
      {t.months.map((m) => (
        <div
          key={m.period}
          title={`${m.period}: ${m.n} сообщений${m.insufficient ? ' (INSUFFICIENT DATA)' : ''} · +${m.pos}/−${m.neg}/±${m.mixed}/?${m.questions}`}
          style={{
            width: 18,
            height: `${Math.max((m.n / max) * 56, m.n > 0 ? 3 : 1)}px`,
            background: m.insufficient ? 'var(--text-faint)' : 'var(--accent)',
            opacity: m.insufficient ? 0.4 : 0.85
          }}
        />
      ))}
      <span className="small faint" style={{ marginLeft: 8 }}>
        {t.months[0]?.period} … {t.months[t.months.length - 1]?.period}
      </span>
    </div>
  );
}

function TopicRow({ t, monthsWindow }: { t: CivicTopicSeries; monthsWindow: number }) {
  const [open, setOpen] = useState(false);
  const cls = CLASS_LABEL[t.classification];
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 0', opacity: t.insufficient ? 0.75 : 1 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(150px, 1.3fr) auto auto auto auto auto auto',
          gap: 12,
          alignItems: 'center'
        }}
      >
        <span className="small" style={{ fontWeight: 600 }} title={t.topic_id}>
          {t.topic_name}
        </span>
        {t.insufficient ? (
          <span
            className="badge muted"
            title={`Выборка последних 3 месяцев ${t.last3_n} < k_min (30). Не показывается как надёжная во избежание риска деанонимизации`}
          >
            INSUFFICIENT DATA
          </span>
        ) : (
          <span className="mono" style={{ fontWeight: 650 }} title="Сообщения за последние 3 месяца окна">
            {t.last3_n.toLocaleString('ru-RU')}
            <span className="faint small"> /3 мес</span>
          </span>
        )}
        <TrendCell t={t} />
        <span className={`badge ${cls.tone}`} title={cls.title}>
          {cls.text}
        </span>
        <Sparkline values={t.months.map((m) => m.n)} width={110} height={24} positive={(t.growth_pct ?? 0) >= 0} />
        <MixBar mix={t.totals.mix} n={t.totals.n} />
        <button className="btn small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Скрыть' : 'Детали'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div className="small faint">
            Всего за окно {monthsWindow} мес: {t.totals.n.toLocaleString('ru-RU')} · вопросов:{' '}
            {t.totals.questions.toLocaleString('ru-RU')} · prev3: {t.prev3_n.toLocaleString('ru-RU')} · рост:{' '}
            {t.growth_pct === null ? '—' : `${t.growth_pct > 0 ? '+' : ''}${t.growth_pct.toFixed(1)}%`}
          </div>
          <MonthlyBars t={t} />
        </div>
      )}
    </div>
  );
}

/** Выбор субъекта: ФО → дети (ленивая загрузка; всегда валидный URL). */
function SubjectPicker({
  districts,
  onPick,
  selected
}: {
  districts: Array<{ geo_id: string; name: string; short_name: string | null }>;
  onPick: (geoId: string) => void;
  selected: string;
}) {
  const [fd, setFd] = useState(districts[0]?.geo_id ?? 'ru:fd:szfo');
  const [open, setOpen] = useState(false);
  const terr = useApi(`${API.territory}/${encodeURIComponent(fd)}`, Territory);
  return (
    <>
      <button
        className={`btn small ${open ? 'primary' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Выбрать субъект РФ"
      >
        Субъект…
      </button>
      {open && (
        <span className="row wrap" style={{ gap: 6 }}>
          <select className="input small" value={fd} onChange={(e) => setFd(e.target.value)} style={{ maxWidth: 220 }}>
            {districts.map((d) => (
              <option key={d.geo_id} value={d.geo_id}>
                {d.short_name ?? d.name}
              </option>
            ))}
          </select>
          {terr.status === 'loading' && <Skeleton h={28} />}
          {terr.status === 'error' && (
            <span className="small" style={{ color: 'var(--danger)' }}>
              ошибка списка
            </span>
          )}
          {terr.status === 'ready' &&
            terr.data?.children.map((c) => (
              <button
                key={c.geo_id}
                className={`btn small ${selected === c.geo_id ? 'primary' : ''}`}
                onClick={() => onPick(c.geo_id)}
                title={c.name}
              >
                {c.short_name ?? c.name}
              </button>
            ))}
        </span>
      )}
    </>
  );
}

export function CivicTrendsScreen() {
  const tree = useApi(API.geoTree, GeoTree);
  const [geoId, setGeoId] = useState('ru:country:ru');
  const [months, setMonths] = useState(12);

  const url = `${API.civicOverview}?geo=${encodeURIComponent(geoId)}&months=${months}`;
  const overview = useApi(url, CivicOverview);

  const geoName =
    geoId === 'ru:country:ru'
      ? 'Россия'
      : (tree.data?.districts.find((d) => d.geo_id === geoId)?.short_name ??
        tree.data?.districts.find((d) => d.geo_id === geoId)?.name ??
        geoId);

  return (
    <>
      <div>
        <h2 className="section-title">CIVIC TRENDS</h2>
        <div className="section-sub">
          Общественные настроения: темы, объём и тональность — ТОЛЬКО агрегаты по территориям. Отдельные сообщения и
          персональные профили отсутствуют в схеме и API. Порог k-анонимности: k_min = {overview.data?.k_min ?? 30}{' '}
          сообщений.
        </div>
      </div>

      {overview.status === 'loading' && <Skeleton h={140} />}
      {overview.status === 'error' && (
        <ErrorBox message={`Данные настроений недоступны: ${overview.error}`} onRetry={overview.reload} />
      )}

      {overview.status === 'ready' && overview.data && (
        <>
          <Panel
            title={`География: ${geoName}`}
            actions={
              <div className="row wrap">
                <Badge
                  tone="warn"
                  title="SYNTHETIC-агрегаты тест-генератора (ADR-0005); отключаются при первом реальном импорте настроений"
                >
                  SYNTHETIC
                </Badge>
                <Badge tone="muted" title="Окно анализа в месяцах">
                  {overview.data.window_months} мес
                </Badge>
              </div>
            }
          >
            <div className="row wrap">
              <button
                className={`btn small ${geoId === 'ru:country:ru' ? 'primary' : ''}`}
                onClick={() => setGeoId('ru:country:ru')}
              >
                Россия
              </button>
              {tree.status === 'ready' &&
                tree.data &&
                tree.data.districts.map((d) => (
                  <button
                    key={d.geo_id}
                    className={`btn small ${geoId === d.geo_id ? 'primary' : ''}`}
                    onClick={() => setGeoId(d.geo_id)}
                    title={d.name}
                  >
                    {d.short_name ?? d.name}
                  </button>
                ))}
              {tree.status === 'ready' && tree.data && (
                <SubjectPicker districts={tree.data.districts} onPick={setGeoId} selected={geoId} />
              )}
            </div>

            <div className="row wrap" style={{ marginTop: 10 }}>
              <span className="small faint">Окно:</span>
              {[6, 12, 24, 36].map((m) => (
                <button key={m} className={`btn small ${months === m ? 'primary' : ''}`} onClick={() => setMonths(m)}>
                  {m} мес
                </button>
              ))}
            </div>

            <div className="row wrap" style={{ marginTop: 12, gap: 24 }}>
              <div>
                <div className="small faint">Сообщений, last 3 мес</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {overview.data.total_last3.toLocaleString('ru-RU')}
                </div>
              </div>
              <div>
                <div className="small faint">Активных тем</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {overview.data.topics.length}
                </div>
              </div>
              <div>
                <div className="small faint">Растущих (≥+25%)</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {overview.data.topics.filter((t) => t.classification === 'rising').length}
                </div>
              </div>
              <div>
                <div className="small faint">Новых (last 3 мес)</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {overview.data.topics.filter((t) => t.classification === 'new').length}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title={`Темы (${overview.data.topics.length})`}>
            {overview.data.topics.length === 0 ? (
              <EmptyState title="Нет данных" note="INSUFFICIENT DATA: в этом гео и окне нет ни одной темы с данными." />
            ) : (
              overview.data.topics.map((t) => (
                <TopicRow key={t.topic_id} t={t} monthsWindow={overview.data!.window_months} />
              ))
            )}
          </Panel>

          <Panel title="METHODOLOGY">
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {overview.data.methodology}
            </div>
            <ul className="small faint" style={{ marginTop: 8, paddingLeft: 18 }}>
              <li>Агрегат-only: в схеме БД нет текстовых колонок — только счётчики по (гео × тема × месяц).</li>
              <li>
                PII-редакция на входе pipeline: телефоны, email, паспорта, карты, СНИЛС, имена-отчества, адреса, URL
                заменяются метками; тексты не сохраняются (журнал — только вид и количество).
              </li>
              <li>
                k-анонимность: месяц или тема с n &lt; k_min помечается INSUFFICIENT DATA и не показывается как
                надёжная выборка.
              </li>
              <li>Классификация тренда — констатация изменения объёма, не оценка и не причинность.</li>
              <li>Анализ ведётся по территориям и агрегатам; профили частных лиц не создаются никогда.</li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
