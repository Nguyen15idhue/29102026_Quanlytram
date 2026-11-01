import { ArrowUpRight, X } from 'lucide-react';
import type { MapStationItem } from '../../types';
import { Button, IconButton, StatusBadge } from '../ui';
import type { MapPermissions } from './MapCanvas';

interface StationListDrawerProps {
  items: MapStationItem[];
  selectedId: number | null;
  loading: boolean;
  error: boolean;
  emptyMessage: string;
  total: number;
  permissions: MapPermissions;
  onSelect: (id: number) => void;
  onOpenDetail: (id: number) => void;
  onClose: () => void;
}

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

export function StationListDrawer({
  items,
  selectedId,
  loading,
  error,
  emptyMessage,
  total,
  permissions,
  onSelect,
  onOpenDetail,
  onClose
}: StationListDrawerProps) {
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <aside
      id="map-station-list"
      className="map-drawer"
      role="dialog"
      aria-label="Danh sách trạm"
    >
      <div className="map-panel-head">
        <strong>Danh sách trạm</strong>
        <span className="muted">{total}</span>
        <IconButton label="Đóng danh sách trạm" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="map-drawer-body">
        {loading ? (
          <div className="table-state">Đang tải bản đồ...</div>
        ) : error ? (
          <div className="table-state error">Không tải được dữ liệu bản đồ.</div>
        ) : items.length === 0 ? (
          <div className="table-state">{emptyMessage}</div>
        ) : (
          <div className="map-list">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`map-list-item ${item.id === selectedId ? 'active' : ''}`}
                onClick={() => onSelect(item.id)}
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
            <Button variant="primary" onClick={() => onOpenDetail(selected.id)}>
              <ArrowUpRight size={16} aria-hidden="true" /> Mở chi tiết trạm
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
