import type { ReactNode } from 'react';

/** Мини-график ряда (SVG, без зависимостей). */
export function Sparkline({
  values,
  width = 120,
  height = 30,
  positive = true
}: {
  values: number[];
  width?: number;
  height?: number;
  positive?: boolean;
}) {
  if (values.length < 2) return <span className="faint small">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => {
      const x = i * step;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = positive ? 'var(--accent)' : 'var(--danger)';
  const last = values[values.length - 1] ?? 0;
  const lastY = height - 3 - ((last - min) / span) * (height - 6);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={width} cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}

/** Стрелка тренда. Направление ≠ «хорошо/плохо»: только изменение. */
export function TrendArrow({
  pct,
  abs
}: {
  pct: number | null;
  abs?: number | null;
}) {
  if (pct === null || Number.isNaN(pct)) return <span className="faint small">—</span>;
  const up = pct > 0.05;
  const down = pct < -0.05;
  const color = up ? 'var(--accent)' : down ? 'var(--info)' : 'var(--text-faint)';
  const glyph = up ? '▲' : down ? '▼' : '—';
  const title = `Изменение к предыдущему периоду: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%${abs !== null && abs !== undefined ? ` (${abs > 0 ? '+' : ''}${abs.toLocaleString('ru-RU')})` : ''}. Это констатация изменения, а не оценка «хорошо/плохо».`;
  return (
    <span className="small mono" style={{ color }} title={title}>
      {glyph} {pct > 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

export function ValueWithUnit({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <span className="faint">—</span>;
  const formatted =
    Math.abs(value) >= 1_000_000
      ? `${(value / 1_000_000).toFixed(2)} млн`
      : Math.abs(value) >= 10_000
        ? Math.round(value).toLocaleString('ru-RU')
        : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return (
    <span className="mono" style={{ fontWeight: 650 }}>
      {formatted}
      {unit ? <span className="faint small"> {unit}</span> : null}
    </span>
  );
}

export function MetricRow({
  name,
  unit,
  value,
  trendPct,
  trendAbs,
  series,
  dataMode,
  onTrust,
  children
}: {
  name: string;
  unit: string;
  value: number | null;
  trendPct: number | null;
  trendAbs: number | null;
  series: number[];
  dataMode: string;
  onTrust?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 1.4fr) auto auto auto auto',
        gap: 12,
        alignItems: 'center',
        padding: '7px 0',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <span className="small" title={name}>{name}</span>
      <ValueWithUnit value={value} unit={unit} />
      <TrendArrow pct={trendPct} abs={trendAbs} />
      <Sparkline values={series} positive={(trendPct ?? 0) >= 0} />
      {dataMode === 'SYNTHETIC' ? (
        <span
          className="badge warn"
          title="СИНТЕТИЧЕСКОЕ значение (тест-генератор), не реальные данные"
        >
          SYN
        </span>
      ) : (
        <span className="badge accent" title="Данные из живого источника">LIVE</span>
      )}
      {onTrust && (
        <button className="btn small" onClick={onTrust} title="Цепочка доказательств">
          Trust
        </button>
      )}
      {children}
    </div>
  );
}
