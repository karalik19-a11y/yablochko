import { useState } from 'react';
import { Badge } from '@yabloko/ui';
import type { TrustChain } from '@yabloko/api-contract';

/**
 * «Why should I trust this?» — цепочка доказательств:
 * VALUE → DATASET (regional_metrics) → SOURCE → METHODOLOGY + оговорки.
 */
export function TrustBox({
  chain,
  label = 'Why should I trust this?'
}: {
  chain: TrustChain;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn small" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <div
          className="fade-in"
          style={{
            marginTop: 10,
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 12.5
          }}
        >
          <div className="row wrap">
            <strong>
              {chain.metric_name} · {chain.geo_name} · {chain.period}
            </strong>
            {chain.data_mode === 'SYNTHETIC' ? (
              <Badge tone="warn" title="Синтетическое значение генератора тест-данных">
                SYNTHETIC
              </Badge>
            ) : (
              <Badge tone="accent">LIVE</Badge>
            )}
          </div>

          <div>
            <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              1. VALUE
            </div>
            <div className="mono">
              {chain.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {chain.unit}
            </div>
          </div>

          <div>
            <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              2. DATASET
            </div>
            <div>
              <span className="mono">{chain.dataset.table}</span> · строка{' '}
              <span className="mono">{chain.dataset.row_key}</span>
              {chain.dataset.updated_at && (
                <span className="faint"> · обновлено {chain.dataset.updated_at}</span>
              )}
            </div>
          </div>

          <div>
            <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              3. SOURCE
            </div>
            <div>
              <strong>{chain.source.name}</strong>{' '}
              <Badge
                tone={chain.source.grade.startsWith('A') ? 'accent' : chain.source.grade.startsWith('B') ? 'info' : 'warn'}
                title={chain.source.note}
              >
                grade {chain.source.grade}
              </Badge>
              <div className="faint small" style={{ marginTop: 3 }}>
                owner: {chain.source.owner ?? '—'} · license: {chain.source.license ?? '—'} ·
                method: {chain.source.collection_method ?? '—'} · last_update:{' '}
                {chain.source.last_update ?? '—'}
                {chain.source.url && (
                  <>
                    {' '}
                    · <span className="mono">{chain.source.url}</span>
                  </>
                )}
                {chain.source.checksum && (
                  <>
                    {' '}
                    · checksum <span className="mono">{chain.source.checksum.slice(0, 12)}…</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              4. METHODOLOGY
            </div>
            <div className="muted">{chain.methodology ?? '—'}</div>
            <div className="faint" style={{ marginTop: 3 }}>
              Покрытие: {chain.coverage.periods} периодов ({chain.coverage.first ?? '—'} —{' '}
              {chain.coverage.last ?? '—'})
            </div>
          </div>

          {chain.caveats.length > 0 && (
            <div>
              <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                ОГОВОРКИ
              </div>
              {chain.caveats.map((c, i) => (
                <div key={i} className="small muted">
                  • {c}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
