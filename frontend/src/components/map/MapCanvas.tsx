import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { AccountFixStatus, MapConfig, MapMode, MapStationItem } from '../../types';
import { ACCOUNT_FIX_LABELS } from '../../lib/mapStatusLabels';
import { accountPinMarkup } from './AccountPin';
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
  return '#991b1b';
}

function markerHtml(item: MapStationItem, selected: boolean): string {
  return `<div class="map-pin ${selected ? 'selected' : ''}" style="--pin-color:${stationColor(
    item
  )}"></div>`;
}

function accountPinHtml(status: AccountFixStatus): string {
  return accountPinMarkup(accountColor(status));
}

function buildAccountPopup(item: MapStationItem, account: MapStationItem['connectedAccounts'][number]) {
  return [
    `<strong>${escapeHtml(account.username)}</strong>`,
    `Tài khoản: ${ACCOUNT_FIX_LABELS[account.fixType]}`,
    `Trạm: ${escapeHtml(item.name)}`,
    `Trạng thái trạm: ${escapeHtml(item.transport)}`
  ].join('<br>');
}

function buildPopup(item: MapStationItem, permissions: MapPermissions): string {
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
    if (item.connectedAccounts.length > 0) {
      lines.push(
        item.connectedAccounts
          .map(
            (account) =>
              `• ${escapeHtml(account.username)} — ${ACCOUNT_FIX_LABELS[account.fixType]}`
          )
          .join('<br>')
      );
    }
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
  const stationMarkersRef = useRef(new Map<number, L.Marker>());
  const tempRef = useRef<L.CircleMarker | null>(null);
  const onTileErrorRef = useRef(onTileError);
  const onSelectRef = useRef(onSelect);
  const initialView = useRef({ center: config.center, zoom: config.zoom });

  onTileErrorRef.current = onTileError;
  onSelectRef.current = onSelect;

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
    stationMarkersRef.current.clear();
    for (const item of items) {
      if (item.lat === null || item.lon === null) continue;
      const selected = item.id === selectedId;
      const icon = L.divIcon({
        className: 'map-pin-wrapper',
        html: markerHtml(item, selected),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      });
      const marker = L.marker([item.lat, item.lon], { icon, riseOnHover: true });
      marker.bindTooltip(item.name, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.95,
        className: 'map-tooltip'
      });
      marker.bindPopup(buildPopup(item, permissions), { minWidth: 180 });
      marker.on('click', () => {
        marker.closeTooltip();
        onSelectRef.current(item.id);
      });
      marker.addTo(layerGroup);
      stationMarkersRef.current.set(item.id, marker);

      if (permissions.online && item.connectedAccounts.length > 0) {
        const total = item.connectedAccounts.length;
        item.connectedAccounts.forEach((account, index) => {
          const offsetX = (index - (total - 1) / 2) * 20;
          const accountIcon = L.divIcon({
            className: 'map-account-wrapper',
            html: accountPinHtml(account.fixType),
            iconSize: [28, 34],
            iconAnchor: [14 + offsetX, 50],
            popupAnchor: [0, -48]
          });
          const accountMarker = L.marker([item.lat as number, item.lon as number], {
            icon: accountIcon,
            riseOnHover: true,
            zIndexOffset: 300
          });
          accountMarker.bindTooltip(account.username, {
            direction: 'top',
            offset: [0, -10],
            opacity: 0.95,
            className: 'map-tooltip'
          });
          accountMarker.bindPopup(buildAccountPopup(item, account), { minWidth: 180 });
          accountMarker.on('click', () => {
            accountMarker.closeTooltip();
            onSelectRef.current(item.id);
          });
          accountMarker.addTo(layerGroup);
        });
      }
    }
  }, [items, permissions]);

  useEffect(() => {
    for (const item of items) {
      const marker = stationMarkersRef.current.get(item.id);
      const pin = marker?.getElement()?.querySelector('.map-pin');
      if (pin) pin.classList.toggle('selected', item.id === selectedId);
    }
  }, [items, selectedId]);

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
