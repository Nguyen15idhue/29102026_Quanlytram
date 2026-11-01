import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { MapConfig, MapMode, MapStationItem } from '../../types';
import {
  attributionForMode,
  maxNativeZoomForMode,
  maxZoomForMode,
  tileUrlForMode
} from '../../lib/mapTile';

export interface MapPermissions {
  quality: boolean;
  relay: boolean;
  online: boolean;
}

export interface MapTempMarker {
  lat: number;
  lon: number;
  label: string;
}

interface MapCanvasProps {
  config: MapConfig;
  mode: MapMode;
  items: MapStationItem[];
  selectedId: number | null;
  permissions: MapPermissions;
  tempMarker?: MapTempMarker | null;
  fitSignal?: number;
  retrySignal?: number;
  onSelect: (id: number) => void;
  onTileError: (message: string | null) => void;
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

function colorFor(item: MapStationItem): string {
  if (item.transport === 'online') return '#1f8a57';
  if (item.transport === 'stale') return '#b7791f';
  if (item.transport === 'offline' || item.transport === 'error') return '#c53030';
  return '#6b7280';
}

function buildPopup(item: MapStationItem, permissions: MapPermissions): string {
  const lines = [
    `<strong>${escapeHtml(item.name)}</strong>`,
    `<span class="mono">#${item.id}</span>`,
    `Trạng thái: ${escapeHtml(item.transport)}`,
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
    lines.push(`Tài khoản online: ${item.onlineAccounts}`);
  }
  lines.push(`<a class="popup-link" href="/stations/${item.id}">Mở chi tiết trạm</a>`);
  return lines.join('<br>');
}

export function MapCanvas({
  config,
  mode,
  items,
  selectedId,
  permissions,
  tempMarker,
  fitSignal = 0,
  retrySignal = 0,
  onSelect,
  onTileError
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const tempRef = useRef<L.CircleMarker | null>(null);
  const onTileErrorRef = useRef(onTileError);
  const initialView = useRef({ center: config.center, zoom: config.zoom });

  onTileErrorRef.current = onTileError;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [initialView.current.center.lat, initialView.current.center.lng],
      zoom: initialView.current.zoom,
      zoomControl: true
    });
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markerLayerRef.current = null;
      tempRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const layer = L.tileLayer(tileUrlForMode(config, mode), {
      attribution: attributionForMode(config, mode),
      maxZoom: maxZoomForMode(config, mode),
      maxNativeZoom: maxNativeZoomForMode(config, mode),
      subdomains: config.subdomains,
      detectRetina: config.retina
    });
    layer.on('tileerror', () =>
      onTileErrorRef.current('Không tải được nền bản đồ. Kiểm tra kết nối hoặc cấu hình tile.')
    );
    layer.on('tileload', () => onTileErrorRef.current(null));
    layer.addTo(map);
    tileRef.current = layer;
    return () => {
      if (tileRef.current) {
        map.removeLayer(tileRef.current);
        tileRef.current = null;
      }
    };
  }, [config, mode, retrySignal]);

  useEffect(() => {
    const layerGroup = markerLayerRef.current;
    if (!layerGroup) return;
    layerGroup.clearLayers();
    for (const item of items) {
      if (item.lat === null || item.lon === null) continue;
      const selected = item.id === selectedId;
      const marker = L.circleMarker([item.lat, item.lon], {
        radius: selected ? 10 : 7,
        color: colorFor(item),
        fillColor: colorFor(item),
        fillOpacity: 0.88,
        weight: selected ? 3 : 2
      });
      marker.bindPopup(buildPopup(item, permissions), { minWidth: 180 });
      marker.on('click', () => onSelect(item.id));
      marker.addTo(layerGroup);
    }
  }, [items, selectedId, permissions, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const coords = items
      .filter((item) => item.lat !== null && item.lon !== null)
      .map((item) => [item.lat as number, item.lon as number] as [number, number]);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.setView(coords[0], Math.max(map.getZoom(), 10));
      return;
    }
    map.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 12 });
  }, [fitSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const selected = items.find((item) => item.id === selectedId);
    if (!selected || selected.lat === null || selected.lon === null) return;
    map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 12), { duration: 0.5 });
  }, [selectedId, items]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tempRef.current) {
      map.removeLayer(tempRef.current);
      tempRef.current = null;
    }
    if (!tempMarker) return;
    const marker = L.circleMarker([tempMarker.lat, tempMarker.lon], {
      radius: 9,
      color: '#1d4ed8',
      fillColor: '#1d4ed8',
      fillOpacity: 0.85,
      weight: 2
    });
    marker.bindTooltip(tempMarker.label).addTo(map);
    marker.openTooltip();
    tempRef.current = marker;
    map.flyTo([tempMarker.lat, tempMarker.lon], Math.max(map.getZoom(), 13), { duration: 0.5 });
    return () => {
      if (tempRef.current) {
        map.removeLayer(tempRef.current);
        tempRef.current = null;
      }
    };
  }, [tempMarker]);

  const className = useMemo(() => 'panel map-canvas leaflet-canvas', []);

  return <div className={className} ref={containerRef} data-testid="map-canvas" />;
}
