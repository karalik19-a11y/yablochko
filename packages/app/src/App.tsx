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
import { TerritoriesScreen } from './screens/Territories.js';
import { TerritoryScreen } from './screens/Territory.js';
import { MetricsExplorer } from './screens/MetricsExplorer.js';
import { CivicTrendsScreen } from './screens/CivicTrends.js';
import { ElectionsScreen } from './screens/Elections.js';
import { PostmortemScreen } from './screens/Postmortem.js';
import { OsintScreen } from './screens/Osint.js';
import { MediaScreen } from './screens/Media.js';

const IMPLEMENTED = new Set([
  'overview',
  'yabloko-position',
  'organization',
  'sources',
  'alerts',
  'settings',
  'territories',
  'population',
  'economy',
  'society',
  'civic-trends',
  'elections',
  'postmortem',
  'osint',
  'media'
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
        {route === 'territories' && (
          <TerritoriesScreen theme={theme} onNavigate={navigate} />
        )}
        {route === 'population' && (
          <MetricsExplorer
            title="POPULATION"
            description="Демография, возрастной и половой состав. Все значения SYNTHETIC до импорта Росстата; каждая метрика несёт источник, методологию и покрытие."
            domains={['demographics', 'age', 'sex']}
          />
        )}
        {route === 'economy' && (
          <MetricsExplorer
            title="ECONOMY"
            description="Экономика, доходы, занятость, бизнес. Тренд — констатация изменения, не оценка и не причинность."
            domains={['economy', 'income', 'employment', 'business']}
          />
        )}
        {route === 'society' && (
          <MetricsExplorer
            title="SOCIETY"
            description="Здравоохранение, образование, жильё, миграция."
            domains={['healthcare', 'education', 'housing', 'migration']}
          />
        )}
        {route.startsWith('territory/') && (
          <TerritoryScreen
            geoId={decodeURIComponent(route.slice('territory/'.length))}
            onNavigate={navigate}
          />
        )}
        {route === 'civic-trends' && <CivicTrendsScreen />}
        {route === 'elections' && <ElectionsScreen />}
        {route === 'postmortem' && <PostmortemScreen />}
        {route === 'osint' && <OsintScreen />}
        {route === 'media' && <MediaScreen />}
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
