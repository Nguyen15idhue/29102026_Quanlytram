import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Maximize2, RotateCcw, X } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { MapMode, MapOverviewResponse, MapStationItem } from '../types';
import { Button, IconButton, Select, StatusBadge } from '../components/ui';
import { MapCanvas, type MapTempMarker } from '../components/map/MapCanvas';
import { TileErrorBanner } from '../components/map/TileErrorBanner';
import { AddressSearch, type AddressResult } from '../components/map/AddressSearch';
import { MapFilterPanel, type MapFilterState } from '../components/map/MapFilterPanel';
import { MapLegend } from '../components/map/MapLegend';
import { MapToolbar, type MapPanel } from '../components/map/MapToolbar';
import { useMapConfig } from '../lib/useMapConfig';

const MODES: Array<{ value: MapMode; label: string }> = [
  { value: 'streets', label: 'Đường phố' },
  { value: 'satellite', label: 'Vệ tinh' },
  { value: 'terrain', label: 'Địa hình' }
];

const BASE_LAYERS = [
  { value: 'stations', label: 'Tất cả trạm' },
  { value: 'online', label: 'Online' },
  { value: 'issues', label: 'Stale / lỗi' },
  { value: 'missing_coords', label: 'Chưa có toạ độ' }
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

function normalizeMode(value: string | null): MapMode {
  return value === 'satellite' || value === 'terrain' ? value : 'streets';
}

function initialLegendOpen(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(min-width: 1024px)').matches;
}

export function UnifiedMap() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tileError, setTileError] = useState<string | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const [tempMarker, setTempMarker] = useState<MapTempMarker | null>(null);
  const [panel, setPanel] = useState<MapPanel>(null);
  const [legendOpen, setLegendOpen] = useState(initialLegendOpen);
  const lastQuery = useRef('');

  const filters: MapFilterState = useMemo(
    () => ({
      q: searchParams.get('q') ?? '',
      layer: searchParams.get('layer') ?? 'stations',
      transport: searchParams.get('transport') ?? '',
      status: searchParams.get('status') ?? '',
      region: searchParams.get('region') ?? '',
      owner: searchParams.get('owner') ?? '',
      hasCoords: searchParams.get('hasCoords') ?? ''
    }),
    [searchParams]
  );
  const mode = normalizeMode(searchParams.get('mode'));
  const stationParam = Number(searchParams.get('station') || 0);
  const stationId = Number.isInteger(stationParam) && stationParam > 0 ? stationParam : null;

  const permissions = useMemo(
    () => ({
      quality: can('quality', 'view'),
      relay: can('relay', 'view'),
      online: can('connections', 'view')
    }),
    [can]
  );

  const applyPatch = useCallback(
    (patch: Record<string, string | number | null>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (!('station' in patch)) next.delete('station');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ layer: filters.layer });
    if (filters.q) params.set('q', filters.q);
    if (filters.region) params.set('region', filters.region);
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.transport) params.set('transport', filters.transport);
    if (filters.status) params.set('status', filters.status);
    if (filters.hasCoords) params.set('hasCoords', filters.hasCoords);
    return params.toString();
  }, [filters]);

  const config = useMapConfig();
  const overview = useQuery({
    queryKey: ['map-overview', query],
    queryFn: () => apiFetch<MapOverviewResponse>(`/api/map/overview?${query}`),
    refetchInterval: 15_000,
    placeholderData: (previous) => previous
  });
  const items = overview.data?.items ?? [];
  const selected = items.find((item) => item.id === stationId) ?? null;
  const counts = overview.data?.counts;

  const layers = useMemo(() => {
    const available = new Set(
      overview.data?.layersAvailable ?? ['stations', 'online', 'issues', 'missing_coords']
    );
    const list = BASE_LAYERS.filter((item) => available.has(item.value));
    if (permissions.quality && available.has('stations')) {
      list.push({ value: 'missing_1005', label: 'Chưa có 1005' });
    }
    if (permissions.online && available.has('online_accounts')) {
      list.push({ value: 'online_accounts', label: 'Có tài khoản online' });
    }
    return list;
  }, [overview.data?.layersAvailable, permissions.quality, permissions.online]);

  const activeFilterCount = useMemo(() => {
    const count = [
      filters.q,
      filters.region,
      filters.owner,
      filters.transport,
      filters.status,
      filters.hasCoords
    ].filter(Boolean).length;
    return count + (filters.layer !== 'stations' ? 1 : 0);
  }, [filters]);

  useEffect(() => {
    if (!overview.data) return;
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    setFitSignal((value) => value + 1);
  }, [overview.data, query]);

  useEffect(() => {
    if (!panel) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel]);

  function togglePanel(next: Exclude<MapPanel, null>) {
    setPanel((current) => (current === next ? null : next));
  }

  function handleReset() {
    applyPatch({
      q: null,
      region: null,
      owner: null,
      transport: null,
      status: null,
      hasCoords: null,
      layer: 'stations',
      station: null
    });
  }

  function handlePickAddress(item: AddressResult) {
    setTempMarker({ lat: item.lat, lon: item.lon, label: item.label });
  }

  const emptyMessage = (() => {
    if (!overview.data) return 'Không có trạm phù hợp bộ lọc.';
    if (counts && counts.all === 0) return 'Không có trạm trong phạm vi bạn được xem.';
    if (filters.hasCoords === '1' && counts && counts.missingCoords > 0) {
      return 'Có trạm nhưng chưa có toạ độ. Hãy nhập toạ độ dự phòng trong form trạm.';
    }
    return 'Không có trạm phù hợp bộ lọc.';
  })();

  const listContent = (
    <>
      {overview.isLoading ? (
        <div className="table-state">Đang tải bản đồ...</div>
      ) : overview.isError ? (
        <div className="table-state error">Không tải được dữ liệu bản đồ.</div>
      ) : items.length === 0 ? (
        <div className="table-state">{emptyMessage}</div>
      ) : (
        <div className="map-list">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`map-list-item ${item.id === stationId ? 'active' : ''}`}
              onClick={() => applyPatch({ station: item.id })}
            >
              <span>
                <strong>{item.name}</strong>
                <small className="mono">{item.id}</small>
              </span>
              <span className="map-list-badges">
                <StatusBadge
                  label={coordLabel(item)}
                  kind={item.hasCoords ? 'info' : 'warn'}
                />
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
    </>
  );

  return (
    <section className="page map-page">
      <h1 className="sr-only">Bản đồ vận hành</h1>

      <div className="map-shell">
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
            tempMarker={tempMarker}
            fitSignal={fitSignal}
            retrySignal={retrySignal}
            onSelect={(id) => applyPatch({ station: id })}
            onTileError={setTileError}
          />
        )}

        <div className="map-search-float">
          <AddressSearch onPick={handlePickAddress} />
        </div>

        <MapToolbar
          panel={panel}
          legendOpen={legendOpen}
          filterCount={activeFilterCount}
          resultCount={counts?.filtered ?? items.length}
          onToggle={togglePanel}
          onToggleLegend={() => setLegendOpen((value) => !value)}
          onFit={() => setFitSignal((value) => value + 1)}
        />

        {legendOpen && (
          <div className="map-legend-card" aria-label="Chú thích trạng thái">
            <strong>Chú thích</strong>
            <MapLegend />
          </div>
        )}

        {panel === 'filter' && (
          <div
            id="map-filter-panel"
            className="map-popover map-filter-popover"
            role="dialog"
            aria-label="Bộ lọc bản đồ"
          >
            <div className="map-panel-head">
              <strong>Bộ lọc bản đồ</strong>
              <IconButton label="Đóng bộ lọc" onClick={() => setPanel(null)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
            <MapFilterPanel
              state={filters}
              layers={layers}
              regions={overview.data?.regions ?? []}
              owners={overview.data?.owners ?? []}
              onChange={(patch) => applyPatch(patch)}
              onReset={handleReset}
              onFit={() => setFitSignal((value) => value + 1)}
            />
          </div>
        )}

        {panel === 'layers' && (
          <div
            id="map-layers-popover"
            className="map-popover map-small-popover"
            role="dialog"
            aria-label="Lớp bản đồ"
          >
            <div className="map-panel-head">
              <strong>Lớp bản đồ</strong>
              <IconButton label="Đóng lớp bản đồ" onClick={() => setPanel(null)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
            <Select
              aria-label="Layer bản đồ"
              value={filters.layer}
              onChange={(event) => applyPatch({ layer: event.target.value })}
            >
              {layers.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {panel === 'modes' && (
          <div
            id="map-modes-popover"
            className="map-popover map-small-popover"
            role="dialog"
            aria-label="Nền bản đồ"
          >
            <div className="map-panel-head">
              <strong>Nền bản đồ</strong>
              <IconButton label="Đóng nền bản đồ" onClick={() => setPanel(null)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
            <Select
              aria-label="Nền bản đồ"
              value={mode}
              onChange={(event) => applyPatch({ mode: event.target.value })}
            >
              {MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {panel === 'list' && (
          <aside
            id="map-station-list"
            className="map-drawer"
            role="dialog"
            aria-label="Danh sách trạm"
          >
            <div className="map-panel-head">
              <strong>Danh sách trạm</strong>
              <span className="muted">{counts?.filtered ?? items.length}</span>
              <IconButton label="Đóng danh sách trạm" onClick={() => setPanel(null)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
            <div className="map-drawer-body">{listContent}</div>
          </aside>
        )}

        <div className="map-fab-group">
          <Button size="sm" onClick={() => setFitSignal((value) => value + 1)}>
            <Maximize2 size={16} aria-hidden="true" /> Fit
          </Button>
          <Button size="sm" onClick={handleReset}>
            <RotateCcw size={16} aria-hidden="true" /> Về mặc định
          </Button>
        </div>

        {tileError && (
          <div className="map-error-float">
            <TileErrorBanner
              message={tileError}
              onRetry={() => {
                setTileError(null);
                setRetrySignal((value) => value + 1);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
