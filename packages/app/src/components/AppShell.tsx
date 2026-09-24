import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@yabloko/ui';
import { NAV, NAV_GROUPS } from '../nav.js';
import { CommandPalette } from './CommandPalette.js';

export interface StatusBar {
  dataMode: string;
  version: string;
}

/**
 * AppShell (Этап 14): сайдбар с клавиатурной навигацией, topbar со статусом
 * данных и переключением темы (без перезагрузки), command palette по Ctrl+K,
 * responsive: сайдбар уходит в off-canvas при узкой ширине (burger).
 */
export function AppShell({
  route,
  onNavigate,
  dataMode,
  version,
  stage,
  theme,
  onToggleTheme,
  children
}: {
  route: string;
  onNavigate: (r: string) => void;
  dataMode: string;
  version: string;
  stage: number;
  theme: string;
  onToggleTheme: () => void;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Ctrl+K / Cmd+K — палитра. Слушатель живёт здесь (владеет состоянием).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" />
      )}
      <aside className="sidebar" aria-label="Разделы">
        <div className="brand">
          <div className="brand-mark">Я</div>
          <div>
            <div className="brand-name">YABLOKO INTELLIGENCE</div>
            <div className="brand-sub">Party Intelligence</div>
          </div>
        </div>
        {NAV_GROUPS.map((group) => (
          <div key={group}>
            <div className="nav-group-label">{group}</div>
            {NAV.filter((n) => n.group === group).map((item) => (
              <div
                key={item.key}
                className={`nav-item ${route === item.key || route.startsWith(`${item.key}/`) ? 'active' : ''} ${item.stage !== null ? 'soon' : ''}`}
                onClick={() => {
                  onNavigate(item.key);
                  closeSidebar();
                }}
                title={item.description}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate(item.key);
                    closeSidebar();
                  }
                }}
              >
                <span className="nav-dot" />
                {item.label}
              </div>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <div>
            v{version} · Этап {stage}/18
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button
              className="btn small"
              onClick={() => setPaletteOpen(true)}
              title="Палитра команд"
            >
              Команды <kbd>Ctrl K</kbd>
            </button>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            className="btn small burger"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Меню разделов"
            title="Меню разделов"
          >
            ☰
          </button>
          <h1 className="section-title" style={{ fontSize: 15 }}>
            {NAV.find((n) => n.key === route || route.startsWith(`${n.key}/`))?.label ?? 'Обзор'}
          </h1>
          <div className="spacer" />
          {dataMode !== 'LIVE' && (
            <Badge tone="warn" title="Данные заполнены seed-набором из INITIAL CONTEXT; все записи требуют верификации официальными источниками">
              SEED DATA · UNVERIFIED
            </Badge>
          )}
          <button className="btn small hide-narrow" onClick={() => setPaletteOpen(true)}>
            Поиск и команды <kbd>Ctrl K</kbd>
          </button>
          <button
            className="btn small"
            onClick={onToggleTheme}
            title="Переключить тему (без перезагрузки)"
            aria-label="Переключить тему"
          >
            {theme === 'dark' ? 'Светлая' : 'Тёмная'}
          </button>
        </header>
        <main className="content" id="main-content">
          <div className="content-inner">{children}</div>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={onNavigate} onToggleTheme={onToggleTheme} />
      )}
    </div>
  );
}
