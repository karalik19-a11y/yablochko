import { z } from 'zod';

/**
 * География РФ. Stable IDs: ru:{level}:{код} (ADR-0008).
 */

export const GeoLevel = z.enum([
  'country',
  'federal_district',
  'subject',
  'municipality',
  'city',
  'district'
]);
export type GeoLevel = z.infer<typeof GeoLevel>;

export const GeoNode = z.object({
  geo_id: z.string(),
  level: GeoLevel,
  name: z.string(),
  short_name: z.string().nullable(),
  parent_id: z.string().nullable(),
  official_code: z.string().nullable(),
  code_system: z.string().nullable(),
  grid_col: z.number().int().nullable(),
  grid_row: z.number().int().nullable(),
  sort_order: z.number().int(),
  is_active: z.number().int(),
  children_count: z.number().int().optional()
});
export type GeoNode = z.infer<typeof GeoNode>;

export const GeoPathNode = z.object({
  geo_id: z.string(),
  name: z.string(),
  level: GeoLevel
});
export type GeoPathNode = z.infer<typeof GeoPathNode>;

export const GeoTree = z.object({
  country: GeoNode.nullable(),
  districts: z.array(GeoNode.extend({ subjects: z.number().int() })),
  totalSubjects: z.number().int().nonnegative(),
  totalMunicipal: z.number().int().nonnegative(),
  municipalCoverage: z.string()
});
export type GeoTree = z.infer<typeof GeoTree>;

export const GeoSearch = z.object({
  query: z.string(),
  items: z.array(GeoNode)
});
export type GeoSearch = z.infer<typeof GeoSearch>;

/** FeatureCollection для MapLibre (картограмма или границы после ingestion). */
export const GeoMap = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      geometry: z.object({
        type: z.literal('Polygon'),
        coordinates: z.array(z.array(z.tuple([z.number(), z.number()])))
      }),
      properties: z.object({
        geo_id: z.string(),
        name: z.string(),
        level: z.string(),
        parent_id: z.string().nullable(),
        parent_name: z.string().nullable(),
        kind: z.enum(['cartogram', 'boundary'])
      })
    })
  ),
  kind: z.enum(['cartogram', 'boundary']),
  methodology: z.string()
});
export type GeoMap = z.infer<typeof GeoMap>;

/** Профиль территории: узел + хлебные крошки + дети + статус разделов. */
export const Territory = z.object({
  node: GeoNode,
  path: z.array(GeoPathNode),
  parent: GeoNode.nullable(),
  children: z.array(GeoNode),
  childLabel: z.string().nullable(),
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      stage: z.number().int().nullable(),
      status: z.literal('insufficient_data')
    })
  )
});
export type Territory = z.infer<typeof Territory>;
