import type { Db } from '../db.js';
import type { Source } from '@yabloko/api-contract';

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export function listSources(db: Db): Source[] {
  const rows = db
    .prepare(`SELECT * FROM sources ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, source_id`)
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => {
    let reliability: { grade: string; note: string } = { grade: '—', note: '' };
    const raw = str(r.reliability_metadata);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { grade?: string; note?: string };
        reliability = { grade: parsed.grade ?? '—', note: parsed.note ?? '' };
      } catch {
        // повреждённый JSON не должен ронять API
      }
    }
    return {
      source_id: str(r.source_id) ?? '',
      name: str(r.name) ?? '',
      owner: str(r.owner),
      url: str(r.url),
      source_type: str(r.source_type) ?? '',
      license: str(r.license),
      collection_method: str(r.collection_method),
      coverage: str(r.coverage),
      period: str(r.period),
      update_frequency: str(r.update_frequency),
      reliability,
      status: (str(r.status) ?? 'planned') as Source['status'],
      update_policy: str(r.update_policy),
      last_update: str(r.last_update),
      checksum: str(r.checksum)
    };
  });
}

export interface SourceCounts {
  total: number;
  active: number;
  planned: number;
  failed: number;
}

export function sourceCounts(db: Db): SourceCounts {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM sources GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const c: SourceCounts = { total: 0, active: 0, planned: 0, failed: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    c.total += n;
    if (r.status === 'active') c.active += n;
    else if (r.status === 'planned') c.planned += n;
    else if (r.status === 'failed') c.failed += n;
  }
  return c;
}
