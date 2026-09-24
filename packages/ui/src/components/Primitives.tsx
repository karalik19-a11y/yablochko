import type { ReactNode } from 'react';

export function Panel({
  title,
  actions,
  glow = false,
  children,
  className = ''
}: {
  title?: string;
  actions?: ReactNode;
  glow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${glow ? 'glow' : ''} ${className}`}>
      {title && (
        <div className="panel-title">
          <span>{title}</span>
          {actions && <span className="title-actions">{actions}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  sub
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  note,
  badge
}: {
  title: string;
  note?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="empty fade-in">
      <div className="empty-title">
        {badge}
        {title}
      </div>
      {note && <div className="empty-note">{note}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box fade-in">
      <span>{message}</span>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 90 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

/** Дата с учётом точности: «2026 (точная дата не подтверждена)». */
export function PrecisionDate({
  date,
  precision
}: {
  date: string | null;
  precision: string;
}) {
  if (!date) return <span className="faint">дата неизвестна</span>;
  if (precision === 'day') return <span>{date}</span>;
  const year = date.slice(0, 4);
  const label =
    precision === 'year'
      ? `${year} (точная дата не подтверждена)`
      : precision === 'month'
        ? `${date.slice(0, 7)} (месяц)`
        : date;
  return (
    <span title="Точность даты ограничена источником">
      {label}
    </span>
  );
}
