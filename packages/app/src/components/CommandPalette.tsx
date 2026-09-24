import { useEffect, useMemo, useRef, useState } from 'react';
import { NAV } from '../nav.js';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
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

  const commands = useMemo<Command[]>(() => {
    const navCommands: Command[] = NAV.map((n) => ({
      id: `nav:${n.key}`,
      label: n.label,
      hint: n.stage !== null ? `Этап ${n.stage}` : n.description,
      run: () => onNavigate(n.key)
    }));
    return [
      ...navCommands,
      {
        id: 'action:theme',
        label: 'Переключить тему (тёмная/светлая)',
        run: onToggleTheme
      },
      {
        id: 'action:verify',
        label: 'Проверить источники (VERIFY SOURCES)',
        hint: 'Реестр источников и статусы верификации',
        run: () => onNavigate('sources')
      },
      {
        id: 'action:positions',
        label: 'Открыть реестр позиций партии',
        run: () => onNavigate('yabloko-position')
      },
      {
        id: 'action:updates',
        label: 'Проверить обновления',
        hint: 'Полная реализация — Этап 16',
        run: () => onNavigate('settings')
      }
    ];
  }, [onNavigate, onToggleTheme]);

  const filtered = commands.filter(
    (c) =>
      query.trim() === '' ||
      c.label.toLowerCase().includes(query.toLowerCase())
  );

  const selectedIdx = Math.min(selected, Math.max(filtered.length - 1, 0));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
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
          placeholder="Поиск: регион, документ, раздел, действие…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && (
            <div className="cmdk-item muted">Ничего не найдено</div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`cmdk-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <span>{c.label}</span>
              <span className="spacer" />
              {c.hint && <span className="faint small">{c.hint}</span>}
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
