export * from './common.js';
export * from './party.js';
export * from './meta.js';

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
  sources: '/api/v1/sources'
} as const;
