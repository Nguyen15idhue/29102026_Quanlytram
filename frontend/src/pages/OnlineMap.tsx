import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { MapPinned } from 'lucide-react';
import { apiFetch } from '../api/client';
import type { CasterConnection, Mountpoint, Station } from '../types';
import { PageHeader, StatusBadge } from '../components/ui';

interface StationList {
  items: Station[];
}

interface MountpointList {
  items: Mountpoint[];
}

interface ConnectionList {
  items: CasterConnection[];
  total: number;
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

export function OnlineMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const stations = useQuery({
    queryKey: ['stations-online-map'],
    queryFn: () => apiFetch<StationList>('/api/stations?page=1&pageSize=100')
  });
  const mountpoints = useQuery({
    queryKey: ['mountpoints-online-map'],
    queryFn: () => apiFetch<MountpointList>('/api/mountpoints?page=1&pageSize=100')
  });
  const connections = useQuery({
    queryKey: ['connections-online-map'],
    queryFn: () => apiFetch<ConnectionList>('/api/connections?page=1&pageSize=100')
  });

  const stationById = useMemo(
    () => new Map((stations.data?.items ?? []).map((station) => [station.id, station])),
    [stations.data?.items]
  );
  const mountpointById = useMemo(
    () => new Map((mountpoints.data?.items ?? []).map((mountpoint) => [mountpoint.id, mountpoint])),
    [mountpoints.data?.items]
  );

  const groups = useMemo(() => {
    const map = new Map<number, { station: Station; accounts: CasterConnection[] }>();
    let withoutCoords = 0;
    for (const connection of connections.data?.items ?? []) {
      const mountpoint = mountpointById.get(connection.mountpointId);
      const station = mountpoint?.station_id ? stationById.get(mountpoint.station_id) : null;
      if (!station || station.lat === null || station.lon === null) {
        withoutCoords += 1;
        continue;
      }
      const group = map.get(station.id) ?? { station, accounts: [] };
      group.accounts.push(connection);
      map.set(station.id, group);
    }
    return { groups: [...map.values()], withoutCoords };
  }, [connections.data?.items, mountpointById, stationById]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current).setView([16.0, 106.0], 5);
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
    for (const group of groups.groups) {
      const { station, accounts } = group;
      if (station.lat === null || station.lon === null) continue;
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 9,
        color: '#1f8a57',
        fillColor: '#1f8a57',
        fillOpacity: 0.9,
        weight: 2
      });
      marker.bindPopup(
        `<strong>${escapeHtml(station.code)}</strong><br>${escapeHtml(station.name)}<br>` +
          `${accounts.length} tài khoản online<br>` +
          accounts
            .slice(0, 8)
            .map((item) => `${escapeHtml(item.accountUsername || '—')} · ${escapeHtml(item.mountpointName)}`)
            .join('<br>')
      );
      marker.addTo(layer);
    }
  }, [groups]);

  return (
    <section className="page">
      <PageHeader
        title="Bản đồ online"
        description="Trạm và tài khoản NTRIP đang online; tài khoản không gửi tọa độ chỉ hiện tổng."
        actions={<MapPinned size={20} className="muted" aria-hidden="true" />}
      />
      <div className="map-shell">
        <aside className="panel map-side">
          <div className="map-summary">
            <StatusBadge label={`${connections.data?.total ?? 0} online`} kind="ok" />
            <StatusBadge
              label={`${groups.withoutCoords} không gửi tọa độ`}
              kind={groups.withoutCoords ? 'warn' : 'neutral'}
            />
          </div>
          <div className="map-list">
            {groups.groups.map(({ station, accounts }) => (
              <div className="map-list-item" key={station.id}>
                <span>
                  <strong>{station.name}</strong>
                  <small className="mono">{station.code}</small>
                </span>
                <StatusBadge label={`${accounts.length} online`} kind="ok" />
              </div>
            ))}
            {groups.groups.length === 0 && (
              <div className="table-state">Chưa có tài khoản online có tọa độ.</div>
            )}
          </div>
        </aside>
        <div className="panel map-canvas" ref={mapRef} />
      </div>
    </section>
  );
}
