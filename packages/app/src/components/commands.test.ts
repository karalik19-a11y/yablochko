import { describe, expect, it } from 'vitest';
import { buildCommands, filterCommands, liveSearchUrls } from './commands.js';
import { NAV } from '../nav.js';
import { initialTheme } from '../theme.js';

/**
 * Этап 14, DoD: палитра команд выполняет все команды мастер-промпта
 * (регион/город/документ/персона/организация/датасет/research/сценарий/
 * сравнение регионов/выборы/позиция/OSINT/обновления) + клавиатура.
 */

const noop = () => {};
const cb = { navigate: noop, toggleTheme: noop };

describe('command palette (команды мастер-промпта)', () => {
  it('содержит все разделы навигации как команды', () => {
    const cmds = buildCommands(cb);
    for (const n of NAV) {
      const c = cmds.find((x) => x.id === `nav:${n.key}`);
      expect(c, `nav:${n.key}`).toBeDefined();
      expect(c?.route).toBe(n.key);
    }
  });

  it('содержит все команды мастер-промпта (кроме живого поиска)', () => {
    const cmds = buildCommands(cb);
    const ids = cmds.map((c) => c.id);
    // сравнение регионов, выборы, позиция, OSINT, research, сценарий, датасет, обновления
    for (const id of [
      'action:compare-regions',
      'action:elections',
      'action:position',
      'action:osint',
      'action:research',
      'action:scenario',
      'action:datasets',
      'action:updates',
      'action:verify',
      'action:theme'
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it('run() выполняет колбэк навигации на правильный маршрут', () => {
    const visited: string[] = [];
    const cmds = buildCommands({ navigate: (r) => visited.push(r), toggleTheme: noop });
    const scenario = cmds.find((c) => c.id === 'action:scenario');
    scenario?.run();
    expect(visited).toEqual(['decision-lab']);
    const compare = cmds.find((c) => c.id === 'action:compare-regions');
    compare?.run();
    expect(visited).toEqual(['decision-lab', 'territories']);
  });

  it('toggle-команда темы вызывает колбэк', () => {
    let toggled = 0;
    const cmds = buildCommands({ navigate: noop, toggleTheme: () => (toggled += 1) });
    cmds.find((c) => c.id === 'action:theme')?.run();
    expect(toggled).toBe(1);
  });

  it('фильтр: пустой запрос — все; подстрока в label или hint', () => {
    const cmds = buildCommands(cb);
    expect(filterCommands(cmds, '')).toHaveLength(cmds.length);
    const byLabel = filterCommands(cmds, 'выборы');
    expect(byLabel.some((c) => c.id === 'action:elections')).toBe(true);
    const byHint = filterCommands(cmds, 'ALADDIN');
    expect(byHint.some((c) => c.id === 'action:scenario')).toBe(true);
    expect(filterCommands(cmds, 'несуществующий-запрос-xyz')).toHaveLength(0);
  });

  it('живой поиск: geo → documents → osint; короткий запрос — пусто', () => {
    expect(liveSearchUrls('а')).toEqual([]);
    const urls = liveSearchUrls('Мос');
    expect(urls.map((u) => u.kind)).toEqual(['geo', 'documents', 'osint']);
    expect(urls[0]?.url).toContain('/geo/search?q=');
    expect(urls[1]?.url).toContain('/documents/search?q=');
    expect(urls[2]?.url).toContain('/osint/search?q=');
    const enc = liveSearchUrls('Москва');
    expect(enc[0]?.url.endsWith(encodeURIComponent('Москва'))).toBe(true);
  });
});

describe('theme (переключение без перезагрузки)', () => {
  const LS = {
    store: new Map<string, string>(),
    getItem(k: string) {
      return this.store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      this.store.set(k, v);
    },
    removeItem(k: string) {
      this.store.delete(k);
    }
  };

  it('по умолчанию тёмная; сохранённая светлая читается; мусор → тёмная', () => {
    const g = globalThis as unknown as { localStorage?: typeof LS };
    g.localStorage = LS;
    expect(initialTheme()).toBe('dark');
    LS.setItem('yabloko.theme', 'light');
    expect(initialTheme()).toBe('light');
    LS.setItem('yabloko.theme', 'blue');
    expect(initialTheme()).toBe('dark');
    delete g.localStorage;
  });

  it('отсутствие localStorage (SSR/тест) не падает — тёмная', () => {
    const g = globalThis as unknown as { localStorage?: typeof LS };
    delete g.localStorage;
    expect(initialTheme()).toBe('dark');
    g.localStorage = LS;
  });
});
