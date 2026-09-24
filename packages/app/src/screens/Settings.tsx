import { Badge, ErrorBox, Panel, Skeleton } from '@yabloko/ui';
import { API, MetaStatus } from '@yabloko/api-contract';
import { useApi } from '../api/hooks.js';

export function SettingsScreen({
  theme,
  onToggleTheme
}: {
  theme: string;
  onToggleTheme: () => void;
}) {
  const meta = useApi(API.metaStatus, MetaStatus);

  return (
    <>
      <div>
        <h2 className="section-title">SETTINGS</h2>
        <div className="section-sub">Тема, режим данных, системная информация.</div>
      </div>

      <Panel title="Внешний вид">
        <div className="row">
          <button className="btn" onClick={onToggleTheme}>
            Тема: {theme === 'dark' ? 'тёмная' : 'светлая'} (переключить)
          </button>
        </div>
      </Panel>

      <Panel title="Данные">
        {meta.status === 'loading' && <Skeleton h={80} />}
        {meta.status === 'error' && (
          <ErrorBox message={meta.error ?? 'Ошибка'} onRetry={meta.reload} />
        )}
        {meta.status === 'ready' && meta.data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row wrap">
              <Badge tone="warn">РЕЖИМ: {meta.data.dataMode}</Badge>
              <span className="small muted">{meta.data.dataModeNote}</span>
            </div>
            <div className="small muted">
              База данных: <span className="mono">{meta.data.database.path}</span> ·
              миграций: {meta.data.database.migrationsApplied} · последний seed:{' '}
              {meta.data.database.lastSeedAt ?? '—'}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Обновления" actions={<Badge tone="muted">ЭТАП 16</Badge>}>
        <div className="small muted">
          Полная реализация появится на Этапе 16: CURRENT/LATEST VERSION,
          RELEASE DATE, CHANGELOG, DOWNLOAD SIZE, кнопки CHECK FOR UPDATES /
          INSTALL UPDATE, проверка подписи апдейта и rollback. Неподписанные
          исполняемые файлы устанавливаться не будут.
        </div>
      </Panel>

      <Panel title="О системе">
        {meta.status === 'ready' && meta.data && (
          <div className="small muted">
            {meta.data.app} · v{meta.data.version} · этап {meta.data.stage} —{' '}
            {meta.data.stageName}. Принципы: evidence-first; нейтральная
            аналитика; запрет профилирования частных лиц; каждая цифра
            прослеживается до исходного документа (Evidence Graph — поэтапно).
          </div>
        )}
      </Panel>
    </>
  );
}
