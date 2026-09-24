import type { SourceConnector } from '../pipeline.js';
import { yablokoRuConnector } from './yablokoRu.js';

/**
 * Реестр коннекторов. Этап 3: один полный pipeline на официальном источнике
 * партии (правило мастер-плана: не масштабировать, пока pipeline не проходит
 * тесты). Следующие коннекторы — rosstat (Этап 5), cik-rf (Этап 8).
 */
const REGISTRY = new Map<string, () => SourceConnector>([
  ['yabloko-ru', yablokoRuConnector]
]);

export function getConnector(sourceId: string): (() => SourceConnector) | null {
  return REGISTRY.get(sourceId) ?? null;
}

export function registeredConnectors(): string[] {
  return [...REGISTRY.keys()];
}
