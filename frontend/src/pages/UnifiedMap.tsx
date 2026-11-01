import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Maximize2, RotateCcw, X } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { MapMode, MapOverviewResponse } from '../types';
import { Button, IconButton, Select } from '../components/ui';
import { MapCanvas, type MapTempMarker } from '../components/map/MapCanvas';
import { TileErrorBanner } from '../components/map/TileErrorBanner';
import { MapSearchBox, type AddressResult } from '../components/map/MapSearchBox';
import { MapFilterPanel, type MapFilterState } from '../components/map/MapFilterPanel';
import { MapLegend } from '../components/map/MapLegend';
import { MapToolbar, type MapPanel } from '../components/map/MapToolbar';
import { StationListDrawer } from '../components/map/StationListDrawer';
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
  const triggerRef = useRef<HTMLElement | null>(null);
  const skipDrawerRef = useRef(false);

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
    if (!stationId) return;
    if (skipDrawerRef.current) {
      skipDrawerRef.current = false;
      return;
    }
    setPanel((current) => (current === 'list' ? current : 'list'));
  }, [stationId]);

  function closePanel() {
    setPanel(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function togglePanel(next: Exclude<MapPanel, null>) {
    if (panel === next) {
      closePanel();
      return;
    }
    triggerRef.current = document.activeElement as HTMLElement | null;
    setPanel(next);
  }

  const handleSearch = useCallback(
    (nextQuery: string) => applyPatch({ q: nextQuery }),
    [applyPatch]
  );

  useEffect(() => {
    if (!panel) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePanel();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.map-popover, .map-drawer, .map-toolbar')) return;
      closePanel();
    }
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [panel]);

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
            onSelect={(id) => {
              skipDrawerRef.current = true;
              applyPatch({ station: id });
            }}
            onTileError={setTileError}
          />
        )}

        <div className="map-search-float">
          <MapSearchBox
            value={filters.q}
            onSearch={handleSearch}
            onPickAddress={handlePickAddress}
          />
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

        {legendOpen && panel === null && (
          <div className="map-legend-card" aria-label="Chú thích trạng thái">
            <strong>Chú thích trạng thái</strong>
            <MapLegend
              stationCounts={counts?.stationStatus}
              accountCounts={counts?.accountStatus}
              showAccounts={permissions.online}
            />
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
              <IconButton label="Đóng bộ lọc" onClick={closePanel}>
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
              <IconButton label="Đóng lớp bản đồ" onClick={closePanel}>
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
              <IconButton label="Đóng nền bản đồ" onClick={closePanel}>
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
          <StationListDrawer
            items={items}
            selectedId={stationId}
            loading={overview.isLoading}
            error={overview.isError}
            emptyMessage={emptyMessage}
            total={counts?.filtered ?? items.length}
            permissions={permissions}
            onSelect={(id) => applyPatch({ station: id })}
            onOpenDetail={(id) => navigate(`/stations/${id}`)}
            onClose={closePanel}
          />
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
