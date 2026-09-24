import { z } from 'zod';

/**
 * OSINT (Этап 10): граф ПУБЛИЧНЫХ сущностей с evidence-рёбрами.
 * Приватные лица не вносятся (person без public_role невозможен в схеме).
 * Никаких профилей сторонников/противников и персональных электоральных данных.
 */

export const OsintEntity = z.object({
  entity_id: z.string(),
  kind: z.enum(['person', 'organization', 'company', 'media']),
  name: z.string(),
  public_role: z.string().nullable(),
  description: z.string().nullable(),
  source_id: z.string(),
  verification_status: z.string(),
  data_mode: z.string()
});
export type OsintEntity = z.infer<typeof OsintEntity>;

export const OsintEdge = z.object({
  edge_id: z.string(),
  src_entity_id: z.string(),
  relation: z.enum(['works_at', 'member_of', 'spoke_at', 'published', 'mentioned', 'associated_with', 'participated_in']),
  dst_entity_id: z.string().nullable(),
  dst_document_id: z.string().nullable(),
  dst_event_id: z.string().nullable(),
  dst_statement_id: z.string().nullable(),
  /** Evidence обязателен (схема отклоняет ребро без доказательства). */
  evidence: z.string(),
  evidence_source_id: z.string(),
  evidence_source_name: z.string().nullable(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  verification_status: z.string()
});
export type OsintEdge = z.infer<typeof OsintEdge>;

export const OsintGraph = z.object({
  entities: z.array(OsintEntity),
  edges: z.array(OsintEdge),
  documents: z.array(
    z.object({
      document_id: z.string(),
      title: z.string(),
      published_date: z.string().nullable(),
      party_document_id: z.string().nullable()
    })
  ),
  events: z.array(
    z.object({
      event_id: z.string(),
      title: z.string(),
      event_date: z.string().nullable(),
      description: z.string().nullable()
    })
  ),
  methodology: z.string(),
  privacy_note: z.string()
});
export type OsintGraph = z.infer<typeof OsintGraph>;

export const OsintProfile = z.object({
  identity: z.object({
    entity_id: z.string(),
    kind: z.string(),
    name: z.string(),
    public_role: z.string().nullable(),
    description: z.string().nullable(),
    verification_status: z.string(),
    source_id: z.string(),
    source_name: z.string().nullable()
  }),
  affiliations: z.array(
    z.object({
      relation: z.string(),
      direction: z.enum(['out', 'in']),
      other_entity_id: z.string().nullable(),
      other_name: z.string().nullable(),
      evidence: z.string(),
      evidence_source_id: z.string(),
      evidence_source_name: z.string().nullable(),
      confidence: z.string()
    })
  ),
  statements: z.array(
    z.object({
      statement_id: z.string(),
      summary: z.string(),
      statement_category: z.string(),
      statement_date: z.string().nullable(),
      position_id: z.string().nullable(),
      source_id: z.string()
    })
  ),
  timeline: z.array(
    z.object({
      date: z.string().nullable(),
      kind: z.string(),
      title: z.string(),
      evidence: z.string(),
      source_id: z.string()
    })
  ),
  sources: z.array(z.object({ source_id: z.string(), source_name: z.string().nullable(), uses: z.number().int() })),
  privacy_note: z.string()
});
export type OsintProfile = z.infer<typeof OsintProfile>;

export const OsintSearchResults = z.object({
  query: z.string(),
  items: z.array(OsintEntity)
});
export type OsintSearchResults = z.infer<typeof OsintSearchResults>;
