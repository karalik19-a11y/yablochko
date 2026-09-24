export * from './common.js';
export * from './party.js';
export * from './meta.js';
export * from './alerts.js';
export * from './documents.js';
export * from './geo.js';
export * from './metrics.js';
export * from './civic.js';

/** Маршруты API v1 (единый источник истины для клиента и сервера). */
export const API = {
  metaStatus: '/api/v1/meta/status',
  partyContext: '/api/v1/party/context',
  partyPositions: '/api/v1/party/positions',
  partyDocuments: '/api/v1/party/documents',
  partyLeaders: '/api/v1/party/leaders',
  partyBodies: '/api/v1/party/bodies',
  partyEvents: '/api/v1/party/events',
  partyCandidates: '/api/v1/party/candidates',
  electionParticipation: '/api/v1/elections/participation',
  sources: '/api/v1/sources',
  documents: '/api/v1/documents',
  documentSearch: '/api/v1/documents/search',
  alerts: '/api/v1/alerts',
  geoTree: '/api/v1/geo/tree',
  geoMap: '/api/v1/geo/map',
  geoSearch: '/api/v1/geo/search',
  territory: '/api/v1/geo/territory',
  metricsCatalog: '/api/v1/metrics/catalog',
  metricsTerritory: '/api/v1/metrics/territory',
  metricsMap: '/api/v1/metrics/map',
  metricsCompare: '/api/v1/metrics/compare',
  metricsTrust: '/api/v1/metrics/trust',
  civicOverview: '/api/v1/civic/overview'
} as const;
