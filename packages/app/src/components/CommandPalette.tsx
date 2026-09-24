import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  DocumentSearch,
  GeoSearch,
  OsintSearchResults,
  ResponseMeta
} from '@yabloko/api-contract';
import {
  buildCommands,
  filterCommands,
  liveSearchUrls
} from './commands.js';

/**
 * Command Palette (Ctrl+K, Этап 14). Разделы + действия мастер-промпта +
 * живой поиск: территории, документы (FTS), публичные сущности OSINT.
 * Клавиатура: ↑/↓/Enter/Esc. setState — только в async-колбэках.
 */

interface GeoHit {
  geo_id: string;
  name: string;
  level: string;
}
interface DocHit {
  doc_id: string;
  title: string | null;
  snippet: string | null;
}
interface OsintHit {
  entity_id: string;
  name: string;
  kind: string;
}

const EMPTY: unique symbol = Symbol('empty');

function useLiveHits<T>(
  query: string,
  urlOf: (q: string) => string | null,
  parseData: (data: unknown) => T[],
  toHit: (item: never) => { key: string; primary: string; secondary: string; route: string } | null,
  onNavigate: (r: string) => void
): Array<{ key: string; primary: string; secondary: string; route: string; run: () => void }> {
  const [hits, setHits] = useState<T[] | typeof EMPTY>(EMPTY);
  useEffect(() => {
    const q = query.trim();
    const url = urlOf(q);
    // Короткий запрос — без setState: «нет результатов» выводится как производное значение.
    if (!url) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const controller = new AbortController();
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((json: unknown) => {
          if (cancelled) return;
          const kind = z
            .object({ data: z.unknown(), meta: ResponseMeta })
            .safeParse(json);
          setHits(kind.success ? parseData(kind.data.data) : []);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  // Производное: при коротком запросе живые хиты скрыты, даже если остались от прошлого.
  if (query.trim().length < 2 || hits === EMPTY) return [];
  return hits
    .map((item) => {
      const h = toHit(item as never);
      return h ? { ...h, run: () => onNavigate(h.route) } : null;
    })
    .filter((x): x is { key: string; primary: string; secondary: string; route: string; run: () => void } => x !== null);
}

export function CommandPalette({
  onClose,
  onNavigate,
  onToggleTheme
}: {
  onClose: () => void;
  onNavigate: (r: string) => void;
  onToggleTheme: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const geoHits = useLiveHits<GeoHit>(
    query,
    (q) => (q.length < 2 ? null : liveSearchUrls(q)[0]?.url ?? null),
    (data) => {
      const parsed = GeoSearch.safeParse(data);
      return parsed.success ? parsed.data.items.slice(0, 5) : [];
    },
    (g: GeoHit) =>
      g.geo_id
        ? { key: `geo:${g.geo_id}`, primary: g.name, secondary: g.level, route: `territory/${encodeURIComponent(g.geo_id)}` }
        : null,
    onNavigate
  );

  const docHits = useLiveHits<DocHit>(
    query,
    (q) => (q.length < 2 ? null : liveSearchUrls(q)[1]?.url ?? null),
    (data) => {
      const parsed = DocumentSearch.safeParse(data);
      return parsed.success ? parsed.data.hits.slice(0, 4) : [];
    },
    (d: DocHit) =>
      d.doc_id
        ? { key: `doc:${d.doc_id}`, primary: d.title ?? d.doc_id, secondary: 'документ', route: 'organization' }
        : null,
    onNavigate
  );

  const osintHits = useLiveHits<OsintHit>(
    query,
    (q) => (q.length < 2 ? null : liveSearchUrls(q)[2]?.url ?? null),
    (data) => {
      const parsed = OsintSearchResults.safeParse(data);
      return parsed.success ? parsed.data.items.slice(0, 4) : [];
    },
    (e: OsintHit) =>
      e.entity_id
        ? { key: `osint:${e.entity_id}`, primary: e.name, secondary: `OSINT · ${e.kind}`, route: `osint/${encodeURIComponent(e.entity_id)}` }
        : null,
    onNavigate
  );

  const commands = useMemo(() => buildCommands({ navigate: onNavigate, toggleTheme: onToggleTheme }), [
    onNavigate,
    onToggleTheme
  ]);
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  const allFiltered = [
    ...geoHits,
    ...docHits,
    ...osintHits,
    ...filtered.map((c) => ({ key: c.id, primary: c.label, secondary: c.hint ?? '', run: c.run }))
  ];
  const maxIdx = Math.max(allFiltered.length - 1, 0);
  const selectedIdx = Math.min(selected, maxIdx);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, maxIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = allFiltered[selectedIdx];
      if (cmd) {
        cmd.run();
        onClose();
      }
    }
  };

  return (
    <div
      className="cmdk-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKey}
    >
      <div className="cmdk" role="dialog" aria-label="Палитра команд">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Регион, документ, персона, раздел, действие…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          aria-label="Поиск команд"
        />
        <div className="cmdk-list" role="listbox">
          {allFiltered.length === 0 && (
            <div className="cmdk-item muted">Ничего не найдено</div>
          )}
          {allFiltered.map((c, i) => (
            <div
              key={c.key}
              role="option"
              aria-selected={i === selectedIdx}
              className={`cmdk-item ${i === selectedIdx ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <span>{c.primary}</span>
              <span className="spacer" />
              {c.secondary && <span className="faint small">{c.secondary}</span>}
            </div>
          ))}
        </div>
        <div className="cmdk-hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> выбор
          </span>
          <span>
            <kbd>Enter</kbd> выполнить
          </span>
          <span>
            <kbd>Esc</kbd> закрыть
          </span>
        </div>
      </div>
    </div>
  );
}
