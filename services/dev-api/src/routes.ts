import { API } from '@yabloko/api-contract';

/**
 * Список маршрутов API v1. Каждый handler возвращает { data, meta } —
 * конверт, валидируемый api-contract на клиенте.
 */

export interface RouteDef {
  url: string;
  handler: () => unknown;
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
  metaStatus: () => unknown;
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
    { url: API.metaStatus, handler: deps.metaStatus }
  ];
}
