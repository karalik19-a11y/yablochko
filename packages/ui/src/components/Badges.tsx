import type { ReactNode } from 'react';

type BadgeTone = 'accent' | 'warn' | 'danger' | 'info' | 'violet' | 'muted';

export function Badge({
  tone = 'muted',
  children,
  title
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Статус верификации → бейдж. UNVERIFIED всегда виден — не прячем неопределённость. */
export function VerificationBadge({ status }: { status: string }) {
  if (status === 'VERIFIED') return <Badge tone="accent">VERIFIED</Badge>;
  if (status === 'REJECTED') return <Badge tone="danger">REJECTED</Badge>;
  return <Badge tone="warn">UNVERIFIED</Badge>;
}

export function PositionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'CURRENT':
      return <Badge tone="accent">CURRENT</Badge>;
    case 'UNVERIFIED':
      return <Badge tone="warn">UNVERIFIED</Badge>;
    case 'SUPERSEDED':
      return (
        <Badge tone="info" title="Заменена более поздней официальной позицией">
          SUPERSEDED
        </Badge>
      );
    case 'EXPIRED':
      return <Badge tone="muted">EXPIRED</Badge>;
    case 'FUTURE':
      return <Badge tone="violet">FUTURE</Badge>;
    default:
      return <Badge tone="muted">{status}</Badge>;
  }
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const tone = confidence === 'HIGH' ? 'accent' : confidence === 'MEDIUM' ? 'info' : 'muted';
  return (
    <Badge tone={tone} title="Уверенность в точности записи (не в содержании позиции)">
      {confidence}
    </Badge>
  );
}

/** Помечает текст как официальное заявление партии — не как установленный факт. */
export function OfficialStatement({
  text,
  label = 'OFFICIAL PARTY STATEMENT'
}: {
  text: string;
  label?: string;
}) {
  return (
    <div className="statement">
      <div className="statement-label">{label}</div>
      <div className="statement-quote">{text}</div>
    </div>
  );
}
