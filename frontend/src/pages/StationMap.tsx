import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { MapPinned } from 'lucide-react';
import { apiFetch } from '../api/client';
import type { Station } from '../types';
import { PageHeader, SearchInput, StatusBadge } from '../components/ui';

interface StationList {
  items: Station[];
  total: number;
}

function stateKind(state?: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'streaming') return 'ok';
  if (state === 'stale') return 'warn';
  if (state === 'error') return 'error';
  return 'neutral';
}

function colorFor(state?: string): string {
  if (state === 'streaming') return '#1f8a57';
  if (state === 'stale') return '#b7791f';
  if (state === 'error') return '#c53030';
  return '#6b7280';
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

export function StationMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Station | null>(null);

  const stations = useQuery({
    queryKey: ['stations-map'],
    queryFn: () => apiFetch<StationList>('/api/stations?page=1&pageSize=100')
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = stations.data?.items ?? [];
    if (!needle) return items;
    return items.filter((station) =>
      [station.code, station.name, station.region, station.address]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [stations.data?.items, q]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([16.0, 106.0], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapInstance.current = map;
    return () => {
      map.remove();
      mapInstance.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const station of filtered) {
      if (station.reported_lat == null || station.reported_lon == null) continue;
      const marker = L.circleMarker([station.reported_lat, station.reported_lon], {
        radius: 7,
        color: colorFor(station.quality_state),
        fillColor: colorFor(station.quality_state),
        fillOpacity: 0.85,
        weight: 2
      });
      marker.bindPopup(
        `<strong>${escapeHtml(station.code)}</strong><br>${escapeHtml(station.name)}<br>` +
          `Trạng thái: ${escapeHtml(station.quality_state || 'unknown')}<br>` +
          `Quality: ${station.quality_score ?? '—'}<br>` +
          `Mountpoint: ${station.mountpoint_count ?? 0}<br>` +
          `WGS84: ${station.reported_lat.toFixed(6)}, ${station.reported_lon.toFixed(6)}`
      );
      marker.on('click', () => setSelected(station));
      marker.addTo(layer);
    }
  }, [filtered]);

  const withCoords = filtered.filter(
    (station) => station.reported_lat != null && station.reported_lon != null
  ).length;

  return (
    <section className="page">
      <PageHeader
        title="Bản đồ trạm"
        description="Toàn bộ trạm trên bản đồ, trạng thái realtime; không gồm relay."
        actions={<MapPinned size={20} className="muted" aria-hidden="true" />}
      />
      <div className="map-shell">
        <aside className="panel map-side">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm trạm, vùng, địa chỉ" />
          <div className="map-summary">
            <StatusBadge label={`${withCoords} có 1005`} kind="ok" />
            <StatusBadge
              label={`${filtered.length - withCoords} chưa có 1005`}
              kind={filtered.length - withCoords ? 'warn' : 'neutral'}
            />
          </div>
          <div className="map-list">
            {filtered.map((station) => (
              <button
                type="button"
                key={station.id}
                className={`map-list-item ${selected?.id === station.id ? 'active' : ''}`}
                onClick={() => {
                  setSelected(station);
                  if (station.reported_lat != null && station.reported_lon != null) {
                    mapInstance.current?.setView([station.reported_lat, station.reported_lon], 13);
                  }
                }}
              >
                <span>
                  <strong>{station.name}</strong>
                  <small className="mono">{station.code}</small>
                </span>
                {station.reported_lat == null || station.reported_lon == null ? (
                  <StatusBadge label="Chưa có 1005" kind="warn" />
                ) : (
                  <StatusBadge
                    label={station.quality_state || 'unknown'}
                    kind={stateKind(station.quality_state)}
                  />
                )}
              </button>
            ))}
          </div>
        </aside>
        <div className="panel map-canvas" ref={mapRef} />
      </div>
    </section>
  );
}
