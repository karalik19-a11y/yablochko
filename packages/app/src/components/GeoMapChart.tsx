import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoMap } from '@yabloko/api-contract';

type FC = { type: 'FeatureCollection'; features: unknown[] };

/**
 * Картограмма субъектов РФ на MapLibre (офлайн: только GeoJSON, без тайлов).
 * Методология слоя обязательна: схематическое представление, не границы.
 * Клик по ячейке → профиль территории (drill-down).
 */
export function GeoMapChart({
  data,
  dark,
  height = 460,
  onPick,
  focusFd,
  fillColorExpr,
  hoverValue
}: {
  data: GeoMap;
  dark: boolean;
  height?: number;
  onPick?: (geoId: string) => void;
  focusFd?: string | null;
  /** MapLibre-выражение fill-color для слоя (хлороплет). */
  fillColorExpr?: unknown[] | null;
  /** Формирователь подписи значения в tooltip. */
  hoverValue?: (props: { geo_id: string; name: string; value?: number | null }) => string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverValueRef = useRef(hoverValue);
  useEffect(() => {
    hoverValueRef.current = hoverValue;
  }, [hoverValue]);
  const [hover, setHover] = useState<{ name: string; parent: string | null; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bg = dark ? '#0d0f12' : '#eef0f3';
    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: false,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }]
      },
      center: [30, 42],
      zoom: 1.1,
      interactive: true
    });
    mapRef.current = map;

    map.on('mousemove' as never, (e: maplibregl.MapMouseEvent) => {
      const fs = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] });
      if (fs.length > 0 && fs[0]) {
        const p = fs[0].properties as {
          name?: string;
          parent_name?: string | null;
          value?: number | null;
          geo_id?: string;
        } | null;
        const hv = hoverValueRef.current;
        const extra = hv && p ? hv({ geo_id: p.geo_id ?? '', name: p.name ?? '', value: p.value ?? null }) : null;
        setHover({
          name: extra ? `${p?.name ?? ''} — ${extra}` : p?.name ?? '',
          parent: p?.parent_name ?? null,
          x: e.point.x,
          y: e.point.y
        });
        map.getCanvas().style.cursor = 'pointer';
      } else {
        setHover(null);
        map.getCanvas().style.cursor = '';
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('regions') as maplibregl.GeoJSONSource | undefined;
      if (!src) {
        map.addSource('regions', { type: 'geojson', data: data as unknown as FC });
        map.addLayer({
          id: 'cells-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': dark ? '#5cbc7c' : '#2e8b52',
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              0.4,
              0.14
            ]
          }
        });
        map.addLayer({
          id: 'cells-line',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': dark ? '#79d096' : '#237647',
            'line-width': 1,
            'line-opacity': 0.5
          }
        });
        map.on('click' as never, 'cells-fill', (e: maplibregl.MapMouseEvent & { features?: Array<maplibregl.MapGeoJSONFeature> }) => {
          const f = e.features?.[0];
          const geoId = f?.properties?.geo_id;
          if (typeof geoId === 'string' && onPick) onPick(geoId);
        });
      } else {
        src.setData(data as unknown as FC);
      }

      // fitBounds по данным
      const b = new maplibregl.LngLatBounds();
      for (const f of data.features) {
        for (const ring of f.geometry.coordinates) {
          for (const [lon, lat] of ring) b.extend([lon, lat]);
        }
      }
      map.fitBounds(b, { padding: 24, duration: 600, maxZoom: 6 });
    };

    if (map.isStyleLoaded()) apply();
    else map.on('load', apply);
  }, [data, dark, onPick]);

  // Хлороплет: применение fill-color выражения
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (fillColorExpr) {
      map.setPaintProperty('cells-fill', 'fill-color', fillColorExpr as never);
      map.setPaintProperty('cells-fill', 'fill-opacity', 0.82);
    } else {
      map.setPaintProperty(
        'cells-fill',
        'fill-color',
        dark ? '#5cbc7c' : '#2e8b52'
      );
      map.setPaintProperty('cells-fill', 'fill-opacity', 0.14);
    }
  }, [fillColorExpr, dark]);

  // Фильтр по федеральному округу (drill-down уровнем выше)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (focusFd) {
      map.setFilter('cells-fill', ['==', ['get', 'parent_id'], focusFd]);
      map.setFilter('cells-line', ['==', ['get', 'parent_id'], focusFd]);
    } else {
      map.setFilter('cells-fill', null);
      map.setFilter('cells-line', null);
    }
  }, [focusFd, data]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {hover && (
        <div
          className="panel"
          style={{
            position: 'absolute',
            left: hover.x + 14,
            top: hover.y + 10,
            padding: '6px 10px',
            pointerEvents: 'none',
            zIndex: 10,
            maxWidth: 260
          }}
        >
          <div className="small" style={{ fontWeight: 650 }}>{hover.name}</div>
          {hover.parent && <div className="small faint">{hover.parent}</div>}
        </div>
      )}
    </div>
  );
}
