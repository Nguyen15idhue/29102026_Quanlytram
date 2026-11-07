import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AccountFixStatus, MapAccountItem, MapMode, MapStationItem } from '../../types';
import { ACCOUNT_FIX_LABELS } from '../../lib/mapStatusLabels';
import type { MapCanvasProps } from './LeafletCanvas';
import { accountPinMarkup } from './AccountPin';
import {
  featureCenter,
  loadProvinces,
  provinceCollection,
  type ProvinceFeature
} from '../../lib/provinces';

const IS_DEV =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

const STATION_SOURCE = 'stations';
const STATION_LAYER = 'stations-layer';
const PROVINCE_SOURCE = 'provinces';
const PROVINCE_LAYER = 'provinces-line';
const STREETS_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function rasterStyle(
  tiles: string,
  attribution: string,
  maxzoom: number
): Record<string, unknown> {
  return {
    version: 8,
    sources: {
      basemap: { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom }
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  };
}

/**
 * Nền MapLibre theo mode:
 * - streets: OpenFreeMap liberty (vector, OSM)
 * - satellite: Esri World Imagery (raster)
 * - terrain: OpenTopoMap (raster, maxzoom 17)
 */
export function maplibreBaseStyle(mode: MapMode): string | Record<string, unknown> {
  if (mode === 'satellite') {
    return rasterStyle(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      '© Esri',
      19
    );
  }
  if (mode === 'terrain') {
    return rasterStyle('https://a.tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap', 17);
  }
  return STREETS_STYLE;
}

function addProvinceLayer(map: maplibregl.Map, features: ProvinceFeature[]) {
  if (map.getLayer(PROVINCE_LAYER)) return;
  if (!map.getSource(PROVINCE_SOURCE)) {
    map.addSource(PROVINCE_SOURCE, {
      type: 'geojson',
      data: provinceCollection(features) as never
    });
  }
  map.addLayer(
    {
      id: PROVINCE_LAYER,
      type: 'line',
      source: PROVINCE_SOURCE,
      paint: {
        'line-color': '#2563eb',
        'line-width': 1,
        'line-opacity': 0.85,
        'line-dasharray': [4, 4]
      }
    },
    map.getLayer(STATION_LAYER) ? STATION_LAYER : undefined
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return map[char];
  });
}

function stationColor(item: MapStationItem): string {
  if (item.transport === 'online') return '#15803d';
  if (item.transport === 'stale') return '#d97706';
  if (item.transport === 'no_data') return '#ea580c';
  if (item.transport === 'offline' || item.transport === 'error') return '#dc2626';
  return '#6b7280';
}

function accountColor(status: AccountFixStatus): string {
  if (status === 'fixed') return '#15803d';
  if (status === 'float') return '#d97706';
  if (status === 'rtd') return '#2563eb';
  if (status === 'single') return '#dc2626';
  if (status === 'none') return '#6b7280';
  return '#991b1b';
}

function buildPopup(item: MapStationItem, permissions: MapCanvasProps['permissions']): string {
  const lines = [
    `<strong>${escapeHtml(item.name)}</strong>`,
    `<span class="mono">#${item.id}</span>`,
    `Trạng thái trạm: ${escapeHtml(item.transport)}`,
    `Toạ độ: ${escapeHtml(item.coordSource)}`
  ];
  if (permissions.quality) {
    lines.push(`Chất lượng: ${item.score ?? '—'} · ${escapeHtml(item.quality)}`);
  }
  lines.push(`Nguồn: ${escapeHtml(item.sourceType || '—')}`);
  lines.push(`Mountpoint: ${item.mountpointCount}`);
  if (permissions.relay && item.relayJobCount !== null) {
    lines.push(`Relay: ${item.relayJobCount}`);
  }
  if (permissions.online) {
    lines.push(
      `Tài khoản: ${
        item.accountStatus ? ACCOUNT_FIX_LABELS[item.accountStatus] : 'Chưa kết nối'
      }`
    );
    for (const account of item.connectedAccounts) {
      lines.push(
        `• ${escapeHtml(account.username)} — ${ACCOUNT_FIX_LABELS[account.fixType]}`
      );
    }
  }
  lines.push(`<a class="popup-link" href="/stations/${item.id}">Mở chi tiết trạm</a>`);
  return lines.join('<br>');
}

function buildAccountPopup(
  item: MapStationItem,
  account: { username: string; fixType: AccountFixStatus }
): string {
  return [
    `<strong>${escapeHtml(account.username)}</strong>`,
    `Tài khoản: ${ACCOUNT_FIX_LABELS[account.fixType]}`,
    `Trạm: ${escapeHtml(item.name)}`,
    `Trạng thái trạm: ${escapeHtml(item.transport)}`
  ].join('<br>');
}

function buildRoverPopup(account: MapAccountItem, stationName: string | null): string {
  const lines = [
    `<strong>${escapeHtml(account.username)}</strong>`,
    `Tài khoản: ${ACCOUNT_FIX_LABELS[account.fixType]}${account.roverStale ? ' (cũ)' : ''}`,
    stationName ? `Trạm: ${escapeHtml(stationName)}` : 'Ngoài trạm'
  ];
  if (account.roverLat !== null && account.roverLon !== null) {
    lines.push(
      `Rover: ${account.roverLat.toFixed(6)}, ${account.roverLon.toFixed(6)}` +
        (account.roverAlt !== null ? ` · cao ${Number(account.roverAlt).toFixed(1)}m` : '') +
        (account.roverSats !== null ? ` · ${account.roverSats} vệ tinh` : '')
    );
  } else {
    lines.push('Rover: chưa có GGA');
  }
  return lines.join('<br>');
}

function pointFeature(
  lon: number,
  lat: number,
  properties: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties
  };
}

function collection(features: Array<Record<string, unknown>>): Record<string, unknown> {
  return { type: 'FeatureCollection', features };
}

type MaplibreCanvasProps = MapCanvasProps & { onFatal?: (reason: string) => void };

export function MaplibreCanvas({
  config,
  mode,
  items,
  selectedId,
  permissions,
  tempMarker,
  fitSignal = 0,
  resetSignal = 0,
  retrySignal = 0,
  onSelect,
  onTileError,
  onFatal,
  showProvinces = false,
  accounts = []
}: MaplibreCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tempRef = useRef<maplibregl.Marker | null>(null);
  const archipelagoRef = useRef<maplibregl.Marker[]>([]);
  const provinceMarkersRef = useRef<maplibregl.Marker[]>([]);
  const accountMarkersRef = useRef(new Map<number, maplibregl.Marker>());
  const provinceSyncRef = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  const onTileErrorRef = useRef(onTileError);
  const onFatalRef = useRef(onFatal);
  const tileErrorTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const initialView = useRef({ center: config.center, zoom: config.zoom });
  const stationDataRef = useRef<Record<string, unknown>>(collection([]));
  const provinceFeaturesRef = useRef<ProvinceFeature[] | null>(null);
  const showProvincesRef = useRef(showProvinces);
  const styleKey = `${mode}|${config.provider}|${config.tileMode}|${config.tileUrl}|${retrySignal}`;
  const styleKeyRef = useRef(styleKey);

  onSelectRef.current = onSelect;
  onTileErrorRef.current = onTileError;
  onFatalRef.current = onFatal;
  showProvincesRef.current = showProvinces;

  const addOverlayLayers = (map: maplibregl.Map) => {
    if (!map.getSource(STATION_SOURCE)) {
      map.addSource(STATION_SOURCE, {
        type: 'geojson',
        data: stationDataRef.current as never
      });
      map.addLayer({
        id: STATION_LAYER,
        type: 'circle',
        source: STATION_SOURCE,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], true], 9, 7] as never,
          'circle-color': ['get', 'color'] as never,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
    }
    if (showProvincesRef.current && provinceFeaturesRef.current) {
      addProvinceLayer(map, provinceFeaturesRef.current);
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: maplibreBaseStyle(mode) as never,
        center: [initialView.current.center.lng, initialView.current.center.lat],
        zoom: initialView.current.zoom,
        attributionControl: false
      });
    } catch {
      onFatalRef.current?.('Không khởi tạo được MapLibre (WebGL)');
      return;
    }
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    if (IS_DEV) {
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
    }

    let loaded = false;
    const loadTimer = window.setTimeout(() => {
      if (!loaded) onFatalRef.current?.('MapLibre không tải xong bản đồ (timeout)');
    }, 20000);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    map.on('load', () => {
      loaded = true;
      window.clearTimeout(loadTimer);
      addOverlayLayers(map);
      setReady(true);
    });
    map.on('style.load', () => {
      addOverlayLayers(map);
    });

    const showPopup = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const html = String(feature?.properties?.popup ?? '');
      const id = Number(feature?.properties?.id ?? 0);
      if (!html) return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
        .setLngLat(event.lngLat)
        .setHTML(html)
        .addTo(map);
      if (Number.isFinite(id) && id > 0) onSelectRef.current(id);
    };
    map.on('click', STATION_LAYER, showPopup);
    map.on('mouseenter', STATION_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', STATION_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('error', (event: maplibregl.ErrorEvent) => {
      if (!event.error) return;
      if (tileErrorTimerRef.current !== null) return;
      tileErrorTimerRef.current = window.setTimeout(() => {
        tileErrorTimerRef.current = null;
        onTileErrorRef.current(
          'Không tải được nền bản đồ. Kiểm tra kết nối hoặc cấu hình tile.'
        );
      }, 1000);
    });
    map.on('sourcedata', (event: maplibregl.MapSourceDataEvent) => {
      if (!event.isSourceLoaded) return;
      if (tileErrorTimerRef.current !== null) {
        window.clearTimeout(tileErrorTimerRef.current);
        tileErrorTimerRef.current = null;
      }
      onTileErrorRef.current(null);
    });

    return () => {
      observer.disconnect();
      window.clearTimeout(loadTimer);
      if (IS_DEV) {
        delete (window as unknown as { __map?: maplibregl.Map }).__map;
      }
      if (tileErrorTimerRef.current !== null) {
        window.clearTimeout(tileErrorTimerRef.current);
        tileErrorTimerRef.current = null;
      }
      popupRef.current?.remove();
      popupRef.current = null;
      tempRef.current?.remove();
      tempRef.current = null;
      for (const marker of archipelagoRef.current) marker.remove();
      archipelagoRef.current = [];
      for (const marker of provinceMarkersRef.current) marker.remove();
      provinceMarkersRef.current = [];
      for (const marker of accountMarkersRef.current.values()) marker.remove();
      accountMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Đổi mode/cấu hình thì đổi hẳn style nền:
  // streets = OpenFreeMap liberty (vector), satellite = Esri, terrain = OpenTopoMap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (styleKeyRef.current === styleKey) return;
    styleKeyRef.current = styleKey;
    map.setStyle(maplibreBaseStyle(mode) as never);
  }, [styleKey, mode, ready]);

  // Marker trạm (tài khoản dùng DOM marker bên dưới).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const stations = collection(
      items
        .filter((item) => item.lat !== null && item.lon !== null)
        .map((item) =>
          pointFeature(item.lon as number, item.lat as number, {
            id: item.id,
            color: stationColor(item),
            selected: item.id === selectedId,
            popup: buildPopup(item, permissions)
          })
        )
    );
    stationDataRef.current = stations;
    (map.getSource(STATION_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      stations as never
    );
  }, [items, permissions, selectedId, ready]);

  // Marker tài khoản: ưu tiên vị trí rover GGA; không GGA mới fallback trạm.
  // Không GGA + ngoài trạm thì bỏ (không có tọa độ để vẽ).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const stationById = new Map(items.map((item) => [item.id, item]));
    const seen = new Set<number>();
    if (permissions.online) {
      const withRover: MapAccountItem[] = [];
      const grouped = new Map<number, MapAccountItem[]>();
      for (const account of accounts) {
        const hasRover =
          account.roverLat !== null &&
          account.roverLon !== null &&
          Number.isFinite(account.roverLat) &&
          Number.isFinite(account.roverLon);
        if (hasRover) {
          withRover.push(account);
          continue;
        }
        if (account.stationId === null) continue;
        const list = grouped.get(account.stationId) ?? [];
        list.push(account);
        grouped.set(account.stationId, list);
      }
      for (const account of withRover) {
        const station = account.stationId !== null ? stationById.get(account.stationId) : undefined;
        const lat = account.roverLat as number;
        const lon = account.roverLon as number;
        const popup = new maplibregl.Popup({
          closeButton: true,
          maxWidth: '320px'
        }).setHTML(buildRoverPopup(account, station ? station.name : null));
        seen.add(account.connectionId);
        upsertRoverMarker(map, account, lon, lat, popup);
      }
      for (const [stationId, list] of grouped) {
        const station = stationById.get(stationId);
        if (!station || station.lat === null || station.lon === null) continue;
        const lat = station.lat;
        const lon = station.lon;
        list.sort((a, b) => a.connectionId - b.connectionId);
        list.forEach((account, index) => {
          const offsetX = (index - (list.length - 1) / 2) * 22;
          const html = accountPinMarkup(accountColor(account.fixType));
          const popup = new maplibregl.Popup({
            closeButton: true,
            maxWidth: '320px'
          }).setHTML(buildAccountPopup(station, account));
          seen.add(account.connectionId);
          let marker = accountMarkersRef.current.get(account.connectionId);
          if (!marker) {
            const element = document.createElement('div');
            element.className = 'map-account-pin';
            element.innerHTML = html;
            element.addEventListener('click', (event) => {
              event.stopPropagation();
              onSelectRef.current(station.id);
            });
            marker = new maplibregl.Marker({
              element,
              anchor: 'bottom',
              offset: [offsetX, 0]
            })
              .setLngLat([lon, lat])
              .setPopup(popup)
              .addTo(map);
            accountMarkersRef.current.set(account.connectionId, marker);
          } else {
            marker.setLngLat([lon, lat]);
            marker.setOffset([offsetX, 0]);
            const element = marker.getElement();
            element.innerHTML = html;
            marker.setPopup(popup);
          }
        });
      }
    }

    function upsertRoverMarker(
      map: maplibregl.Map,
      account: MapAccountItem,
      lon: number,
      lat: number,
      popup: maplibregl.Popup
    ): void {
      const html = accountPinMarkup(accountColor(account.fixType));
      let marker = accountMarkersRef.current.get(account.connectionId);
      if (!marker) {
        const element = document.createElement('div');
        element.className = 'map-account-pin';
        element.innerHTML = html;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          if (account.stationId !== null) onSelectRef.current(account.stationId);
        });
        marker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, 0] })
          .setLngLat([lon, lat])
          .setPopup(popup)
          .addTo(map);
        accountMarkersRef.current.set(account.connectionId, marker);
      } else {
        marker.setLngLat([lon, lat]);
        marker.setOffset([0, 0]);
        marker.getElement().innerHTML = html;
        marker.setPopup(popup);
      }
    }

    for (const [connectionId, marker] of accountMarkersRef.current) {
      if (!seen.has(connectionId)) {
        marker.remove();
        accountMarkersRef.current.delete(connectionId);
      }
    }
  }, [accounts, items, permissions.online, ready]);

  // Nhãn quần đảo: dùng Marker DOM để không phụ thuộc glyphs của MapLibre.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const marker of archipelagoRef.current) marker.remove();
    archipelagoRef.current = [];
    if (!config.archipelagoLabels) return;
    const labels = [
      { lat: 17.0, lng: 112.35, text: 'Quần đảo Hoàng Sa' },
      { lat: 9.95, lng: 114.4, text: 'Quần đảo Trường Sa' }
    ];
    for (const label of labels) {
      const element = document.createElement('span');
      element.className = 'map-archipelago';
      element.textContent = label.text;
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([label.lng, label.lat])
        .addTo(map);
      archipelagoRef.current.push(marker);
    }
    const sync = () => {
      const visible = map.getZoom() >= config.archipelagoMinZoom;
      for (const marker of archipelagoRef.current) {
        marker.getElement().style.display = visible ? '' : 'none';
      }
    };
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [config.archipelagoLabels, config.archipelagoMinZoom, ready]);

  // Ranh giới + tên tỉnh: line layer + DOM marker (không phụ thuộc glyphs).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const removeLayers = () => {
      if (provinceSyncRef.current) {
        map.off('zoomend', provinceSyncRef.current);
        provinceSyncRef.current = null;
      }
      for (const marker of provinceMarkersRef.current) marker.remove();
      provinceMarkersRef.current = [];
      if (map.getLayer(PROVINCE_LAYER)) map.removeLayer(PROVINCE_LAYER);
      if (map.getSource(PROVINCE_SOURCE)) map.removeSource(PROVINCE_SOURCE);
    };

    if (!showProvinces) {
      provinceFeaturesRef.current = null;
      removeLayers();
      return;
    }

    let cancelled = false;
    loadProvinces()
      .then((features) => {
        if (cancelled || !mapRef.current) return;
        provinceFeaturesRef.current = features;
        removeLayers();
        addProvinceLayer(map, features);

        provinceMarkersRef.current = features
          .map((feature) => {
            const center = featureCenter(feature);
            const name = String(feature.properties?.name ?? '').trim();
            if (!center || !name) return null;
            const element = document.createElement('span');
            element.className = 'map-province-label';
            element.textContent = name;
            return new maplibregl.Marker({ element, anchor: 'center' })
              .setLngLat(center)
              .addTo(map);
          })
          .filter((marker): marker is maplibregl.Marker => marker !== null);

        const sync = () => {
          const visible = map.getZoom() >= 6;
          for (const marker of provinceMarkersRef.current) {
            marker.getElement().style.display = visible ? '' : 'none';
          }
        };
        provinceSyncRef.current = sync;
        sync();
        map.on('zoomend', sync);
      })
      .catch(() => {
        // Lớp phụ: lỗi tải không làm hỏng bản đồ chính.
      });

    return () => {
      cancelled = true;
      removeLayers();
    };
  }, [showProvinces, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const coords = items
      .filter((item) => item.lat !== null && item.lon !== null)
      .map((item) => [item.lon as number, item.lat as number] as [number, number]);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 10) });
      return;
    }
    const bounds = coords.reduce(
      (acc, coord) => acc.extend(coord),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );
    map.fitBounds(bounds, { padding: 32, maxZoom: 12, duration: 0 });
  }, [fitSignal, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || resetSignal === 0) return;
    map.jumpTo({ center: [config.center.lng, config.center.lat], zoom: config.zoom });
  }, [resetSignal, config.center.lat, config.center.lng, config.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const selected = items.find((item) => item.id === selectedId);
    if (!selected || selected.lat === null || selected.lon === null) return;
    map.easeTo({
      center: [selected.lon, selected.lat],
      zoom: Math.max(map.getZoom(), 12),
      duration: 500
    });
  }, [selectedId, items, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    tempRef.current?.remove();
    tempRef.current = null;
    if (!tempMarker) return;
    const marker = new maplibregl.Marker({ color: '#1d4ed8' })
      .setLngLat([tempMarker.lon, tempMarker.lat])
      .setPopup(new maplibregl.Popup().setText(tempMarker.label))
      .addTo(map);
    marker.togglePopup();
    tempRef.current = marker;
    map.easeTo({
      center: [tempMarker.lon, tempMarker.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 500
    });
    return () => {
      tempRef.current?.remove();
      tempRef.current = null;
    };
  }, [tempMarker, ready]);

  const className = useMemo(() => 'panel map-canvas maplibre-canvas', []);

  return <div className={className} ref={containerRef} data-testid="map-canvas" />;
}
