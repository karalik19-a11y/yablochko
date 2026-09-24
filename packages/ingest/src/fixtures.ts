import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Режим fixture: коннекторы читают локальные снимки вместо сети.
 * Используется в песочнице (без доступа к официальным источникам) и в
 * контрактных тестах. Snapshot помечается fetch_mode='fixture' — выдать
 * фикстуру за живые данные невозможно.
 */

export interface FixtureFetch {
  (url: string, init?: { method?: string }): Promise<Response>;
  fixtureDir: string;
}

export function createFixtureFetch(fixtureDir: string): FixtureFetch {
  const manifestPath = resolve(fixtureDir, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>)
    : {};

  const fn = ((url: string) => {
    const file = manifest[url];
    if (!file) {
      return Promise.resolve(
        new Response(`fixture miss: ${url}`, { status: 404, headers: { 'content-type': 'text/plain' } })
      );
    }
    const body = readFileSync(resolve(fixtureDir, file), 'utf8');
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    );
  }) as FixtureFetch;

  fn.fixtureDir = fixtureDir;
  return fn;
}
