import type { SourceConnector } from '../pipeline.js';

/**
 * Yabloko Source Layer: коннектор официального сайта партии.
 *
 * DISCOVER: стартовая страница; дальнейшие документы находятся обходом ссылок
 * того же хоста (PARSE извлекает ссылки, pipeline обходит в глубину 1).
 *
 * Реальные данные доступны только при наличии сети (CI / локальный запуск у
 * владельца данных). В песочнице коннектор работает на fixture-снимках
 * (fetch_mode='fixture') — см. datasets/fixtures/yabloko-ru/.
 */
export function yablokoRuConnector(): SourceConnector {
  return {
    sourceId: 'yabloko-ru',
    discover: () => [{ url: 'https://yabloko.ru/', depth: 0 }]
  };
}
