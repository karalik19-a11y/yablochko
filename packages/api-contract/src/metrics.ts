import { z } from 'zod';

/**
 * Population Intelligence: территориальные показатели с полным provenance.
 * Единый формат regional_metrics (value/period/source/quality/methodology).
 */

export const MetricSeriesPoint = z.object({
  period: z.string(),
  value: z.number()
});
export type MetricSeriesPoint = z.infer<typeof MetricSeriesPoint>;

export const MetricProvenance = z.object({
  source_id: z.string(),
  source_name: z.string(),
  source_grade: z.string(),
  source_note: z.string(),
  license: z.string().nullable(),
  url: z.string().nullable(),
  last_update: z.string().nullable(),
  checksum: z.string().nullable(),
  data_mode: z.string(),
  methodology: z.string().nullable(),
  coverage_periods: z.number().int(),
  first_period: z.string().nullable(),
  last_period: z.string().nullable()
});
export type MetricProvenance = z.infer<typeof MetricProvenance>;

export const MetricView = z.object({
  code: z.string(),
  domain: z.string(),
  name: z.string(),
  unit: z.string(),
  latest: MetricSeriesPoint.nullable(),
  previous: MetricSeriesPoint.nullable(),
  trend_abs: z.number().nullable(),
  trend_pct: z.number().nullable(),
  series: z.array(MetricSeriesPoint),
  provenance: MetricProvenance
});
export type MetricView = z.infer<typeof MetricView>;

export const DomainView = z.object({
  domain: z.string(),
  title: z.string(),
  section: z.string(),
  metrics: z.array(MetricView)
});
export type DomainView = z.infer<typeof DomainView>;

export const TerritoryMetrics = z.object({
  geo_id: z.string(),
  domains: z.array(DomainView)
});
export type TerritoryMetrics = z.infer<typeof TerritoryMetrics>;

export const MetricCatalogEntry = z.object({
  code: z.string(),
  domain: z.string(),
  name: z.string(),
  unit: z.string()
});
export type MetricCatalogEntry = z.infer<typeof MetricCatalogEntry>;

export const MetricsCatalog = z.object({
  domains: z.array(
    z.object({ domain: z.string(), title: z.string(), section: z.string() })
  ),
  metrics: z.array(MetricCatalogEntry)
});
export type MetricsCatalog = z.infer<typeof MetricsCatalog>;

export const MetricMapValues = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  period: z.string(),
  data_mode: z.string(),
  values: z.array(
    z.object({
      geo_id: z.string(),
      name: z.string(),
      parent_id: z.string().nullable(),
      value: z.number(),
      period: z.string(),
      unit: z.string(),
      data_mode: z.string()
    })
  )
});
export type MetricMapValues = z.infer<typeof MetricMapValues>;

export const CompareData = z.object({
  period: z.string(),
  codes: z.array(z.string()),
  rows: z.array(
    z.object({
      geo_id: z.string(),
      name: z.string(),
      parent_id: z.string().nullable(),
      fd_name: z.string().nullable(),
      values: z.record(z.string(), z.number().nullable()),
      units: z.record(z.string(), z.string())
    })
  )
});
export type CompareData = z.infer<typeof CompareData>;

/** Цепочка доказательств для кнопки «Why should I trust this?». */
export const TrustChain = z.object({
  geo_id: z.string(),
  geo_name: z.string(),
  metric_code: z.string(),
  metric_name: z.string(),
  unit: z.string(),
  period: z.string(),
  value: z.number(),
  data_mode: z.string(),
  dataset: z.object({
    table: z.string(),
    row_key: z.string(),
    updated_at: z.string().nullable()
  }),
  source: z.object({
    source_id: z.string(),
    name: z.string(),
    owner: z.string().nullable(),
    url: z.string().nullable(),
    license: z.string().nullable(),
    collection_method: z.string().nullable(),
    grade: z.string(),
    note: z.string(),
    last_update: z.string().nullable(),
    checksum: z.string().nullable()
  }),
  methodology: z.string().nullable(),
  coverage: z.object({
    periods: z.number().int(),
    first: z.string().nullable(),
    last: z.string().nullable()
  }),
  caveats: z.array(z.string())
});
export type TrustChain = z.infer<typeof TrustChain>;
