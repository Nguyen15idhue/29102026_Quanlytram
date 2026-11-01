import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { ArrowUpRight, MapPinned } from 'lucide-react';
import { apiFetch } from '../api/client';
import type { MapOverviewResponse, MapStationItem } from '../types';
import { Button, PageHeader, SearchInput, Select, StatusBadge } from '../components/ui';

const LAYERS = [
  { value: 'stations', label: 'Tất cả trạm' },
  { value: 'online', label: 'Online' },
  { value: 'issues', label: 'Stale / lỗi' },
  { value: 'online_accounts', label: 'Có tài khoản online' },
  { value: 'missing_1005', label: 'Chưa có 1005' }
];

function stateKind(state: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'online') return 'ok';
  if (state === 'stale') return 'warn';
  if (state === 'offline' || state === 'error') return 'error';
  return 'neutral';
}

function colorFor(item: MapStationItem): string {
  if (!item.has1005) return '#6b7280';
  if (item.transport === 'online') return '#1f8a57';
  if (item.transport === 'stale') return '#b7791f';
  if (item.transport === 'offline' || item.transport === 'error') return '#c53030';
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

export function UnifiedMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const region = searchParams.get('region') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const layer = searchParams.get('layer') ?? 'stations';
  const stationParam = Number(searchParams.get('station') || 0);
  const stationId = Number.isInteger(stationParam) && stationParam > 0 ? stationParam : null;

  function update(patch: Record<string, string | number | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next, { replace: true });
  }

  const query = useMemo(() => {
    const params = new URLSearchParams({ layer });
    if (q) params.set('q', q);
    if (region) params.set('region', region);
    if (owner) params.set('owner', owner);
    return params.toString();
  }, [layer, q, region, owner]);
  const overview = useQuery({
    queryKey: ['map-overview', query],
    queryFn: () => apiFetch<MapOverviewResponse>(`/api/map/overview?${query}`),
    refetchInterval: 15_000
  });
  const items = overview.data?.items ?? [];
  const selected = items.find((item) => item.id === stationId) ?? null;

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
    const layerGroup = layerRef.current;
    if (!layerGroup) return;
    layerGroup.clearLayers();
    for (const item of items) {
      if (!item.has1005 || item.lat === null || item.lon === null) continue;
      const marker = L.circleMarker([item.lat, item.lon], {
        radius: item.id === stationId ? 10 : 7,
        color: colorFor(item),
        fillColor: colorFor(item),
        fillOpacity: 0.88,
        weight: item.id === stationId ? 3 : 2
      });
      marker.bindPopup(
        `<strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.name)}<br>` +
          `Transport: ${escapeHtml(item.transport)}<br>` +
          `Quality: ${item.score ?? '—'} · ${escapeHtml(item.quality)}<br>` +
          `Mountpoint: ${item.mountpointCount} · Relay: ${item.relayJobCount}<br>` +
          `Online account: ${item.onlineAccounts}`
      );
      marker.on('click', () => update({ station: item.id }));
      marker.addTo(layerGroup);
    }
  }, [items, stationId]);

  useEffect(() => {
    if (!selected || selected.lat === null || selected.lon === null) return;
    mapInstance.current?.flyTo([selected.lat, selected.lon], 12, { duration: 0.5 });
  }, [selected?.id]);

  return (
    <section className="page">
      <PageHeader
        title="Bản đồ vận hành"
        description="Một bản đồ hợp nhất: trạng thái, quality, relay, tài khoản online và toạ độ 1005."
        actions={<MapPinned size={20} className="muted" aria-hidden="true" />}
      />

      <div className="map-shell">
        <aside className="panel map-side">
          <SearchInput value={q} onChange={(value) => update({ q: value, station: null })} placeholder="Tìm trạm, vùng, địa chỉ" />
          <Select
            aria-label="Layer bản đồ"
            value={layer}
            onChange={(event) => update({ layer: event.target.value, station: null })}
          >
            {LAYERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc vùng"
            value={region}
            onChange={(event) => update({ region: event.target.value, station: null })}
          >
            <option value="">Mọi vùng</option>
            {(overview.data?.regions ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc owner"
            value={owner}
            onChange={(event) => update({ owner: event.target.value, station: null })}
          >
            <option value="">Mọi owner</option>
            {(overview.data?.owners ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>

          <div className="map-summary">
            <StatusBadge label={`${overview.data?.counts.online ?? 0} online`} kind="ok" />
            <StatusBadge
              label={`${overview.data?.counts.issues ?? 0} stale/lỗi`}
              kind={overview.data?.counts.issues ? 'warn' : 'neutral'}
            />
            <StatusBadge
              label={`${overview.data?.counts.missing_1005 ?? 0} chưa 1005`}
              kind={overview.data?.counts.missing_1005 ? 'warn' : 'neutral'}
            />
            <StatusBadge
              label={`${overview.data?.counts.online_accounts ?? 0} có online`}
              kind="info"
            />
          </div>

          {overview.isLoading ? (
            <div className="table-state">Đang tải bản đồ...</div>
          ) : overview.isError ? (
            <div className="table-state error">Không tải được dữ liệu bản đồ.</div>
          ) : items.length === 0 ? (
            <div className="table-state">Không có trạm phù hợp bộ lọc.</div>
          ) : (
            <div className="map-list">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`map-list-item ${item.id === stationId ? 'active' : ''}`}
                  onClick={() => update({ station: item.id })}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small className="mono">{item.id}</small>
                  </span>
                  {item.has1005 ? (
                    <StatusBadge label={item.transport} kind={stateKind(item.transport)} />
                  ) : (
                    <StatusBadge label="Chưa 1005" kind="warn" />
                  )}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="map-detail">
              <div className="detail-subhead">
                <h4>{selected.name}</h4>
                <StatusBadge label={selected.transport} kind={stateKind(selected.transport)} />
              </div>
              <dl className="facts">
                <div>
                  <dt>Quality</dt>
                  <dd>
                    {selected.score ?? '—'} · {selected.quality}
                  </dd>
                </div>
                <div>
                  <dt>Nguồn</dt>
                  <dd>{selected.sourceType || '—'}</dd>
                </div>
                <div>
                  <dt>Mountpoint</dt>
                  <dd className="mono">{selected.mountpointCount}</dd>
                </div>
                <div>
                  <dt>Relay job</dt>
                  <dd className="mono">{selected.relayJobCount}</dd>
                </div>
                <div>
                  <dt>Tài khoản online</dt>
                  <dd className="mono">{selected.onlineAccounts}</dd>
                </div>
                <div>
                  <dt>Vùng</dt>
                  <dd>{selected.region || '—'}</dd>
                </div>
              </dl>
              <Button variant="primary" onClick={() => navigate(`/stations/${selected.id}`)}>
                <ArrowUpRight size={16} aria-hidden="true" /> Mở chi tiết trạm
              </Button>
            </div>
          )}
        </aside>

        <div className="panel map-canvas" ref={mapRef} />
      </div>
    </section>
  );
}
