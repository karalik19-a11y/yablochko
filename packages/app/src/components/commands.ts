import { NAV } from '../nav.js';
import { API } from '@yabloko/api-contract';

/**
 * Реестр команд палитры (Этап 14, ARCHITECTURE §8 Command Palette Ctrl+K).
 * Команды мастер-промпта: регион/город/документ/персона/организация/датасет/
 * research/сценарий/сравнение регионов/выборы/позиция/OSINT/обновления.
 * Чистая функция (тестируется); живой поиск — отдельные хуки в палитре.
 */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Таргет-роут для навигационных команд (тестируемость без колбэков). */
  route?: string;
  run: () => void;
}

export interface CommandCallbacks {
  navigate: (route: string) => void;
  toggleTheme: () => void;
}

/** Все команды палитры: разделы + действия мастер-промпта. */
export function buildCommands(cb: CommandCallbacks): Command[] {
  const navCommands: Command[] = NAV.map((n) => ({
    id: `nav:${n.key}`,
    label: n.label,
    hint: n.stage !== null ? `Этап ${n.stage}` : n.description,
    route: n.key,
    run: () => cb.navigate(n.key)
  }));
  return [
    ...navCommands,
    // --- Действия мастер-промпта ---
    {
      id: 'action:compare-regions',
      label: 'Сравнение регионов',
      hint: 'Дриллдаун ФО → субъект; метрики по территориям',
      route: 'territories',
      run: () => cb.navigate('territories')
    },
    {
      id: 'action:elections',
      label: 'Выборы: база и явка',
      hint: 'Election Intelligence с official_source',
      route: 'elections',
      run: () => cb.navigate('elections')
    },
    {
      id: 'action:position',
      label: 'Позиция партии',
      hint: 'Реестр позиций (OFFICIAL PARTY STATEMENT)',
      route: 'yabloko-position',
      run: () => cb.navigate('yabloko-position')
    },
    {
      id: 'action:osint',
      label: 'OSINT: публичные сущности',
      hint: 'Граф с evidence-рёбрами; приватные лица не вносятся',
      route: 'osint',
      run: () => cb.navigate('osint')
    },
    {
      id: 'action:research',
      label: 'Research Workspace',
      hint: 'Yabloko Policy Lab: цепочка позиции',
      route: 'research',
      run: () => cb.navigate('research')
    },
    {
      id: 'action:scenario',
      label: 'Смоделировать сценарий',
      hint: 'Decision Lab / ALADDIN: «при предположениях…»',
      route: 'decision-lab',
      run: () => cb.navigate('decision-lab')
    },
    {
      id: 'action:datasets',
      label: 'Датасеты: показатели территорий',
      hint: 'Каталог метрик и trust-цепочки',
      route: 'population',
      run: () => cb.navigate('population')
    },
    {
      id: 'action:updates',
      label: 'Обновления и алерты',
      hint: 'Alert Center; авто-обновления — Этап 16',
      route: 'alerts',
      run: () => cb.navigate('alerts')
    },
    {
      id: 'action:verify',
      label: 'VERIFY SOURCES: реестр источников',
      hint: 'Source Registry: grade, checksum, статусы',
      route: 'sources',
      run: () => cb.navigate('sources')
    },
    {
      id: 'action:ask-analyst',
      label: 'Спросить AI-аналитика',
      hint: 'ANSWER / EVIDENCE / SOURCES / UNCERTAINTY',
      route: 'analyst',
      run: () => cb.navigate('analyst')
    },
    {
      id: 'action:theme',
      label: 'Переключить тему (тёмная/светлая)',
      hint: 'Без перезагрузки страницы',
      run: cb.toggleTheme
    }
  ];
}

/** Фильтр по label+hint (без диакритической нормализации — RU/EN подстроки). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q === '') return commands;
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q)
  );
}

/** Ранги живого поиска:geo → документы → сущности. URL для fetch (тестируемость). */
export function liveSearchUrls(query: string, trimmedMin = 2): Array<{ kind: string; url: string }> {
  const q = query.trim();
  if (q.length < trimmedMin) return [];
  const enc = encodeURIComponent(q);
  return [
    { kind: 'geo', url: `${API.geoSearch}?q=${enc}` },
    { kind: 'documents', url: `${API.documentSearch}?q=${enc}` },
    { kind: 'osint', url: `${API.osintSearch}?q=${enc}` }
  ];
}
