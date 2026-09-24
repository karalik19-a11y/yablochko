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
  civicOverview: (q: Record<string, string>) => unknown;
  positionsMatrix: (q: Record<string, string>) => unknown;
  electionsList: (q: Record<string, string>) => unknown;
  electionDetail: (q: Record<string, string>) => unknown;
  electionsYablokoHistory: () => unknown;
  electionsRegional: (q: Record<string, string>) => unknown;
  electionsCandidates: (q: Record<string, string>) => unknown;
  electionsPostmortem: (q: Record<string, string>) => unknown;
  osintGraph: () => unknown;
  osintEntity: (q: Record<string, string>) => unknown;
  osintSearch: (q: Record<string, string>) => unknown;
  mediaMentions: (q: Record<string, string>) => unknown;
  mediaTopics: (q: Record<string, string>) => unknown;
  mediaTrend: (q: Record<string, string>) => unknown;
  mediaSources: () => unknown;
  decisionTemplates: () => unknown;
  decisionCompute: (q: Record<string, string>) => unknown;
  decisionScenarios: (q: Record<string, string>) => unknown;
  analystStatus: () => unknown;
  analystAsk: (body: Record<string, unknown>) => unknown;
  analystVerify: (body: Record<string, unknown>) => unknown;
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
    { url: API.civicOverview, handler: (q) => deps.civicOverview(q) },
    { url: API.positionsMatrix, handler: (q) => deps.positionsMatrix(q) },
    { url: API.electionsList, handler: (q) => deps.electionsList(q) },
    { url: API.electionDetail, handler: (q) => deps.electionDetail(q) },
    { url: API.electionsYablokoHistory, handler: () => deps.electionsYablokoHistory() },
    { url: API.electionsRegional, handler: (q) => deps.electionsRegional(q) },
    { url: API.electionsCandidates, handler: (q) => deps.electionsCandidates(q) },
    { url: API.electionsPostmortem, handler: (q) => deps.electionsPostmortem(q) },
    { url: API.osintGraph, handler: () => deps.osintGraph() },
    { url: API.osintEntity, handler: (q) => deps.osintEntity(q) },
    { url: API.osintSearch, handler: (q) => deps.osintSearch({ q: String(q.q ?? '') }) },
    { url: API.mediaMentions, handler: (q) => deps.mediaMentions(q) },
    { url: API.mediaTopics, handler: (q) => deps.mediaTopics(q) },
    { url: API.mediaTrend, handler: (q) => deps.mediaTrend(q) },
    { url: API.mediaSources, handler: () => deps.mediaSources() },
    { url: API.decisionTemplates, handler: () => deps.decisionTemplates() },
    { url: API.decisionCompute, handler: (q) => deps.decisionCompute(q) },
    { url: API.decisionScenarios, handler: (q) => deps.decisionScenarios(q) },
    { url: API.analystStatus, handler: () => deps.analystStatus() },
    {
      url: API.analystAsk,
      method: 'POST',
      handler: () => ({}),
      postHandler: (body) => deps.analystAsk(body)
    },
    {
      url: API.analystVerify,
      method: 'POST',
      handler: () => ({}),
      postHandler: (body) => deps.analystVerify(body)
    },
    { url: API.metaStatus, handler: deps.metaStatus }
  ];
}
