import { useEffect } from 'react';
import { AppShell } from './components/AppShell.js';
import { useHashRoute } from './router.js';
import { useTheme } from './theme.js';
import { useApi } from './api/hooks.js';
import { API, MetaStatus } from '@yabloko/api-contract';
import { OverviewScreen } from './screens/Overview.js';
import { PositionsScreen } from './screens/Positions.js';
import { OrganizationScreen } from './screens/Organization.js';
import { SourcesScreen } from './screens/Sources.js';
import { SettingsScreen } from './screens/Settings.js';
import { AlertsScreen } from './screens/Alerts.js';
import { PlaceholderScreen } from './screens/Placeholder.js';

const IMPLEMENTED = new Set([
  'overview',
  'yabloko-position',
  'organization',
  'sources',
  'alerts',
  'settings'
]);

export function App() {
  const [route, navigate] = useHashRoute();
  const [theme, toggleTheme] = useTheme();
  const meta = useApi(API.metaStatus, MetaStatus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Палитра открывается в AppShell; здесь только перехват хоткея
        // для предотвращения стандартного поведения браузера.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dataMode = meta.data?.dataMode ?? 'SEED';
  const version = meta.data?.version ?? '0.2.0';

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      dataMode={dataMode}
      version={version}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      <div key={route} className="fade-in">
        {route === 'overview' && <OverviewScreen onNavigate={navigate} />}
        {route === 'yabloko-position' && <PositionsScreen />}
        {route === 'organization' && <OrganizationScreen />}
        {route === 'sources' && <SourcesScreen />}
        {route === 'alerts' && <AlertsScreen />}
        {route === 'settings' && (
          <SettingsScreen theme={theme} onToggleTheme={toggleTheme} />
        )}
        {!IMPLEMENTED.has(route) && <PlaceholderScreen route={route} />}
      </div>
    </AppShell>
  );
}
