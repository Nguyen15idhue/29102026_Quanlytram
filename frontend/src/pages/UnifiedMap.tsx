import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, MapPinned } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { MapMode, MapOverviewResponse, MapStationItem } from '../types';
import { Button, PageHeader, SearchInput, Select, StatusBadge } from '../components/ui';
import { MapCanvas } from '../components/map/MapCanvas';
import { TileErrorBanner } from '../components/map/TileErrorBanner';
import { useMapConfig } from '../lib/useMapConfig';

const BASE_LAYERS = [
  { value: 'stations', label: 'Tất cả trạm' },
  { value: 'online', label: 'Online' },
  { value: 'issues', label: 'Stale / lỗi' },
  { value: 'missing_coords', label: 'Chưa có toạ độ' },
  { value: 'missing_1005', label: 'Chưa có 1005' }
];

function stateKind(state: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'online') return 'ok';
  if (state === 'stale') return 'warn';
  if (state === 'offline' || state === 'error') return 'error';
  return 'neutral';
}

function coordLabel(item: MapStationItem): string {
  if (item.coordSource === '1005') return '1005';
  if (item.coordSource === 'station') return 'Dự phòng';
  return 'Chưa có';
}

export function UnifiedMap() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const region = searchParams.get('region') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const layer = searchParams.get('layer') ?? 'stations';
  const mode = (searchParams.get('mode') as MapMode) || 'streets';
  const stationParam = Number(searchParams.get('station') || 0);
  const stationId = Number.isInteger(stationParam) && stationParam > 0 ? stationParam : null;

  const [tileError, setTileError] = useState<string | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const lastQuery = useRef('');

  const permissions = useMemo(
    () => ({
      quality: can('quality', 'view'),
      relay: can('relay', 'view'),
      online: can('connections', 'view')
    }),
    [can]
  );

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

  const config = useMapConfig();
  const overview = useQuery({
    queryKey: ['map-overview', query],
    queryFn: () => apiFetch<MapOverviewResponse>(`/api/map/overview?${query}`),
    refetchInterval: 15_000
  });
  const items = overview.data?.items ?? [];
  const selected = items.find((item) => item.id === stationId) ?? null;
  const layersAvailable = overview.data?.layersAvailable ?? BASE_LAYERS.map((item) => item.value);
  const layers = BASE_LAYERS.filter((item) => layersAvailable.includes(item.value));
  if (permissions.online) {
    layers.push({ value: 'online_accounts', label: 'Có tài khoản online' });
  }

  useEffect(() => {
    if (!overview.data) return;
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    setFitSignal((value) => value + 1);
  }, [overview.data, query]);

  return (
    <section className="page">
      <PageHeader
        title="Bản đồ vận hành"
        description="Một bản đồ hợp nhất: trạng thái, chất lượng, relay và tài khoản online."
        actions={<MapPinned size={20} className="muted" aria-hidden="true" />}
      />

      <TileErrorBanner
        message={tileError}
        onRetry={() => {
          setTileError(null);
          setRetrySignal((value) => value + 1);
        }}
      />

      <div className="map-shell">
        <aside className="panel map-side">
          <SearchInput
            value={q}
            onChange={(value) => update({ q: value, station: null })}
            placeholder="Tìm trạm, vùng, địa chỉ"
          />
          <Select
            aria-label="Layer bản đồ"
            value={layer}
            onChange={(event) => update({ layer: event.target.value, station: null })}
          >
            {layers.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Nền bản đồ"
            value={mode}
            onChange={(event) => update({ mode: event.target.value })}
          >
            <option value="streets">Đường phố</option>
            <option value="satellite">Vệ tinh</option>
            <option value="terrain">Địa hình</option>
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
              label={`${overview.data?.counts.withCoords ?? 0} có toạ độ`}
              kind="info"
            />
            <StatusBadge
              label={`${overview.data?.counts.missingCoords ?? 0} thiếu toạ độ`}
              kind={overview.data?.counts.missingCoords ? 'warn' : 'neutral'}
            />
            {permissions.online && (
              <StatusBadge
                label={`${overview.data?.counts.online_accounts ?? 0} có online`}
                kind="info"
              />
            )}
          </div>

          <div className="map-actions">
            <Button type="button" onClick={() => setFitSignal((value) => value + 1)}>
              Fit kết quả
            </Button>
            <Button
              type="button"
              onClick={() => update({ q: null, region: null, owner: null, station: null })}
            >
              Xoá lọc
            </Button>
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
                  <span className="map-list-badges">
                    <StatusBadge label={coordLabel(item)} kind={item.hasCoords ? 'info' : 'warn'} />
                    <StatusBadge label={item.transport} kind={stateKind(item.transport)} />
                  </span>
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
                  <dt>Toạ độ</dt>
                  <dd>
                    {selected.lat !== null && selected.lon !== null
                      ? `${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`
                      : '—'}{' '}
                    <span className="muted">({coordLabel(selected)})</span>
                  </dd>
                </div>
                {permissions.quality && (
                  <div>
                    <dt>Chất lượng</dt>
                    <dd>
                      {selected.score ?? '—'} · {selected.quality}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Nguồn</dt>
                  <dd>{selected.sourceType || '—'}</dd>
                </div>
                <div>
                  <dt>Mountpoint</dt>
                  <dd className="mono">{selected.mountpointCount}</dd>
                </div>
                {permissions.relay && selected.relayJobCount !== null && (
                  <div>
                    <dt>Relay job</dt>
                    <dd className="mono">{selected.relayJobCount}</dd>
                  </div>
                )}
                {permissions.online && (
                  <div>
                    <dt>Tài khoản online</dt>
                    <dd className="mono">{selected.onlineAccounts}</dd>
                  </div>
                )}
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

        {config.isLoading ? (
          <div className="panel map-canvas table-state">Đang tải cấu hình bản đồ...</div>
        ) : config.isError || !config.data ? (
          <div className="panel map-canvas table-state error">
            Không tải được cấu hình bản đồ.
          </div>
        ) : (
          <MapCanvas
            config={config.data.config}
            mode={mode}
            items={items}
            selectedId={stationId}
            permissions={permissions}
            fitSignal={fitSignal}
            retrySignal={retrySignal}
            onSelect={(id) => update({ station: id })}
            onTileError={setTileError}
          />
        )}
      </div>
    </section>
  );
}
