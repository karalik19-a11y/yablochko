import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SeedBundle, type SeedBundle as SeedBundleT } from './seed.js';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Загружает seed-набор из каталога datasets/party.
 * Отдельные файлы необязательны — отсутствующие дают пустые коллекции.
 */
export function loadSeedDir(dir: string): SeedBundleT {
  const p = (name: string) => resolve(dir, name);

  const sources = existsSync(p('sources.json'))
    ? readJson(p('sources.json'))
    : [];
  const partyFile = existsSync(p('party.json')) ? readJson(p('party.json')) : null;
  const documents = existsSync(p('documents.json'))
    ? readJson(p('documents.json'))
    : [];
  const positionsFile = existsSync(p('positions.json'))
    ? readJson(p('positions.json'))
    : { positions: [] };
  const events = existsSync(p('events.json')) ? readJson(p('events.json')) : [];
  const candidatesFile = existsSync(p('candidates.json'))
    ? readJson(p('candidates.json'))
    : { candidates: [] };
  const participationFile = existsSync(p('election_participation.json'))
    ? readJson(p('election_participation.json'))
    : { participation: [] };

  const raw = {
    sources,
    party:
      partyFile !== null && typeof partyFile === 'object' && 'party' in partyFile
        ? (partyFile as { party: unknown }).party
        : null,
    bodies:
      partyFile !== null && typeof partyFile === 'object' && 'bodies' in partyFile
        ? (partyFile as { bodies: unknown }).bodies
        : [],
    leaders:
      partyFile !== null && typeof partyFile === 'object' && 'leaders' in partyFile
        ? (partyFile as { leaders: unknown }).leaders
        : [],
    documents,
    positions:
      typeof positionsFile === 'object' && positionsFile !== null && 'positions' in positionsFile
        ? (positionsFile as { positions: unknown }).positions
        : [],
    events,
    candidates:
      typeof candidatesFile === 'object' &&
      candidatesFile !== null &&
      'candidates' in candidatesFile
        ? (candidatesFile as { candidates: unknown }).candidates
        : [],
    participation:
      typeof participationFile === 'object' &&
      participationFile !== null &&
      'participation' in participationFile
        ? (participationFile as { participation: unknown }).participation
        : []
  };

  return SeedBundle.parse(raw);
}
