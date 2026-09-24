import { API } from '@yabloko/api-contract';

/**
 * Список маршрутов API v1. Каждый handler возвращает { data, meta } —
 * конверт, валидируемый api-contract на клиенте.
 */

export interface RouteDef {
  url: string;
  method?: 'GET' | 'POST';
  handler: (query: Record<string, string>, params?: Record<string, string>) => unknown;
  postHandler?: (body: Record<string, unknown>) => unknown;
}

export interface RouteDeps {
  partyContext: () => unknown;
  positions: () => unknown;
  documents: () => unknown;
  leaders: () => unknown;
  bodies: () => unknown;
  events: () => unknown;
  candidates: () => unknown;
  participation: () => unknown;
  sources: () => unknown;
  sourceDocuments: (query: { source?: string; limit?: number; offset?: number }) => unknown;
  documentSearch: (query: { q?: string }) => unknown;
  alerts: (query: { openOnly?: string }) => unknown;
  acknowledge: (alertId: string) => boolean;
  geoTree: () => unknown;
  geoMap: (q: Record<string, string>) => unknown;
  geoSearch: (q: Record<string, string>) => unknown;
  territory: (geoId: string) => unknown;
  metricsCatalog: () => unknown;
  metricsTerritory: (geoId: string) => unknown;
  metricsMap: (q: Record<string, string>) => unknown;
  metricsCompare: (q: Record<string, string>) => unknown;
  metricsTrust: (q: Record<string, string>) => unknown;
  metaStatus: () => unknown;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function buildRoutes(deps: RouteDeps): RouteDef[] {
  return [
    { url: API.partyContext, handler: deps.partyContext },
    { url: API.partyPositions, handler: deps.positions },
    { url: API.partyDocuments, handler: deps.documents },
    { url: API.partyLeaders, handler: deps.leaders },
    { url: API.partyBodies, handler: deps.bodies },
    { url: API.partyEvents, handler: deps.events },
    { url: API.partyCandidates, handler: deps.candidates },
    { url: API.electionParticipation, handler: deps.participation },
    { url: API.sources, handler: deps.sources },
    {
      url: API.documents,
      handler: (q) =>
        deps.sourceDocuments({
          source: q.source,
          limit: num(q.limit, 50),
          offset: num(q.offset, 0)
        })
    },
    { url: API.documentSearch, handler: (q) => deps.documentSearch({ q: q.q }) },
    { url: API.alerts, handler: deps.alerts },
    {
      url: API.alerts,
      method: 'POST',
      handler: () => ({}),
      postHandler: (body) => {
        const alertId = typeof body.alert_id === 'string' ? body.alert_id : null;
        if (!alertId) return { ok: false, error: 'alert_id обязателен' };
        // acknowledgeAlert импортируется в app.ts через deps.alerts-замыкание;
        // здесь — через обращение к общей функции, проброшенной в deps.
        return { ok: true, alert_id: alertId, acknowledged: deps.acknowledge?.(alertId) ?? false };
      }
    },
    { url: API.geoTree, handler: deps.geoTree },
    { url: API.geoMap, handler: deps.geoMap },
    { url: API.geoSearch, handler: (q) => deps.geoSearch({ q: String(q.q ?? '') }) },
    {
      url: `${API.territory}/:geoId`,
      handler: (_q, params) => deps.territory(String(params?.['geoId'] ?? ''))
    },
    { url: API.metricsCatalog, handler: deps.metricsCatalog },
    {
      url: `${API.metricsTerritory}/:geoId`,
      handler: (_q, params) => deps.metricsTerritory(String(params?.['geoId'] ?? ''))
    },
    { url: API.metricsMap, handler: deps.metricsMap },
    { url: API.metricsCompare, handler: deps.metricsCompare },
    { url: API.metricsTrust, handler: deps.metricsTrust },
    { url: API.metaStatus, handler: deps.metaStatus }
  ];
}
