import { Badge, EmptyState, Panel } from '@yabloko/ui';
import { NAV } from '../nav.js';

export function PlaceholderScreen({ route }: { route: string }) {
  const item = NAV.find((n) => n.key === route);
  return (
    <>
      <div>
        <h2 className="section-title">{item?.label ?? route}</h2>
        <div className="section-sub">{item?.description}</div>
      </div>
      <Panel>
        <EmptyState
          title={`Раздел появится на Этапе ${item?.stage ?? '?'}`}
          note="Каждый этап оставляет приложение в рабочем состоянии: этот экран намеренно пуст, а не заполнен фиктивными данными. Дорожная карта — docs/ROADMAP.md."
          badge={<Badge tone="warn">INSUFFICIENT DATA</Badge>}
        />
      </Panel>
    </>
  );
}
