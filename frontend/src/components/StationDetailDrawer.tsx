import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clock3,
  Database,
  History as HistoryIcon,
  Link2,
  Pencil,
  Radio,
  RadioTower,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type {
  StationConnectionMountpoint,
  StationConnectionsResponse,
  StationDetail,
  StationHistoryResponse,
  StationMetadataResponse,
  StationReliability,
  StationMetadataStatus,
  StationQualityStatus,
  StationTransportStatus
} from '../types';
import { Button, EmptyState, Modal, Pagination, StatusBadge, Tabs } from './ui';
import { QualityPanel } from './QualityPanel';
import { formatNumber } from './charts';

export type StationDetailTab = 'overview' | 'connection' | 'quality' | 'metadata' | 'history';

const TABS: Array<{ value: StationDetailTab; label: string }> = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'connection', label: 'Kết nối' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'history', label: 'Lịch sử' }
];

function formatLocal(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function transportKind(value: StationTransportStatus): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'online') return 'ok';
  if (value === 'stale') return 'warn';
  if (value === 'offline' || value === 'error') return 'error';
  return 'neutral';
}

function qualityKind(value: StationQualityStatus): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'good') return 'ok';
  if (value === 'warning') return 'warn';
  if (value === 'critical') return 'error';
  return 'neutral';
}

function metadataKind(value: StationMetadataStatus): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'ok') return 'ok';
  if (value === 'warning') return 'warn';
  if (value === 'critical') return 'error';
  return 'neutral';
}

function sourceKind(source: string): 'ok' | 'warn' | 'error' | 'info' | 'neutral' {
  if (source === 'quality') return 'ok';
  if (source === 'caster') return 'info';
  if (source === 'relay') return 'warn';
  if (source === 'audit') return 'neutral';
  return 'neutral';
}

function reliabilityRows(reliability: StationReliability) {
  return [
    ['Cửa sổ', `${reliability.windowSec} giây`],
    ['Sample', String(reliability.sampleCount)],
    ['Sample hợp lệ', String(reliability.validSampleCount)],
    ['Độ đầy đủ', `${Math.round(reliability.dataCompleteness * 100)}%`],
    ['Bắt đầu quan sát', formatLocal(reliability.observationStartedAt)],
    ['Score cập nhật', formatLocal(reliability.scoreUpdatedAt)],
    ['Dữ liệu cuối', formatLocal(reliability.lastDataAt)]
  ];
}

function ReliabilityBlock({ reliability }: { reliability: StationReliability }) {
  return (
    <div className="quality-card reliability-block">
      <h3>
        <ShieldCheck size={16} aria-hidden="true" /> Độ tin cậy của score
      </h3>
      <dl className="reliability-grid">
        {reliabilityRows(reliability).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Điểm score chỉ đáng tin khi cửa sổ quan sát đủ mẫu; hệ thống không tự tính lại score ở
        frontend.
      </p>
    </div>
  );
}

function StatusGrid({ station }: { station: StationDetail }) {
  return (
    <div className="detail-status-grid">
      <div>
        <span className="muted">Transport</span>
        <StatusBadge
          label={station.transportStatus}
          kind={transportKind(station.transportStatus)}
        />
      </div>
      <div>
        <span className="muted">Quality</span>
        <StatusBadge label={station.qualityStatus} kind={qualityKind(station.qualityStatus)} />
      </div>
      <div>
        <span className="muted">Metadata</span>
        <StatusBadge
          label={station.metadataStatus}
          kind={metadataKind(station.metadataStatus)}
        />
      </div>
    </div>
  );
}

function OnlineConnections({
  items,
  empty
}: {
  items: StationConnectionsResponse['onlineConnections'];
  empty: string;
}) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="connection-list">
      {items.map((connection) => (
        <div className="connection-item" key={`${connection.id}-${connection.startTs}`}>
          <span>
            <strong className="mono">{connection.accountUsername || connection.remoteAddr}</strong>
            <small className="muted">
              {connection.listenerName || `Listener #${connection.listenerId}`} ·{' '}
              {connection.direction} · {formatLocal(connection.startTs)}
            </small>
          </span>
          <span className="muted mono">
            in {formatNumber(connection.bytesIn)} · out {formatNumber(connection.bytesOut)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MountpointConnection({ mountpoint }: { mountpoint: StationConnectionMountpoint }) {
  return (
    <article className="connection-card">
      <div className="connection-card-head">
        <div>
          <h3 className="mono">{mountpoint.name}</h3>
          <p className="muted">
            {mountpoint.serviceType || 'rtcm'} · {mountpoint.positionMode || 'normal'} ·{' '}
            {mountpoint.satelliteSystems || 'chưa khai báo hệ vệ tinh'}
          </p>
        </div>
        <div className="connection-badges">
          <StatusBadge
            label={mountpoint.enabled ? 'enabled' : 'disabled'}
            kind={mountpoint.enabled ? 'ok' : 'neutral'}
          />
          <StatusBadge
            label={mountpoint.requiresAuth ? 'auth' : 'no-auth'}
            kind={mountpoint.requiresAuth ? 'info' : 'warn'}
          />
        </div>
      </div>

      <dl className="facts">
        <div>
          <dt>Listener</dt>
          <dd>
            {mountpoint.listeners.length === 0
              ? 'Chưa gán listener'
              : mountpoint.listeners
                  .map((listener) => `${listener.name} :${listener.port} (${listener.role})`)
                  .join(' · ')}
          </dd>
        </div>
        <div>
          <dt>Kết nối online</dt>
          <dd className="mono">{mountpoint.onlineConnections.length}</dd>
        </div>
        <div>
          <dt>Caster interval</dt>
          <dd className="mono">{mountpoint.casterInterval || '—'}</dd>
        </div>
        <div>
          <dt>Code</dt>
          <dd>
            {mountpoint.codeProtocol || '—'} / {mountpoint.codeType || '—'}
          </dd>
        </div>
      </dl>

      <div className="detail-subhead">
        <h4>Relay job</h4>
        <span className="muted">{mountpoint.relays.length} job</span>
      </div>
      {mountpoint.relays.length === 0 ? (
        <p className="muted">Chưa có relay job lấy mountpoint này.</p>
      ) : (
        <div className="connection-list">
          {mountpoint.relays.map((relay) => (
            <div className="connection-item block" key={relay.id}>
              <div className="connection-item-head">
                <strong>{relay.name}</strong>
                <div className="connection-badges">
                  <StatusBadge
                    label={relay.runtimeState}
                    kind={
                      relay.runtimeState === 'streaming'
                        ? 'ok'
                        : relay.runtimeState === 'error'
                          ? 'error'
                          : relay.runtimeState === 'backoff'
                            ? 'warn'
                            : 'neutral'
                    }
                  />
                  <StatusBadge
                    label={relay.enabled ? 'enabled' : 'disabled'}
                    kind={relay.enabled ? 'ok' : 'neutral'}
                  />
                </div>
              </div>
              <div className="muted table-subline">
                Desired {relay.desiredRevision} · Applied {relay.appliedRevision ?? '—'} ·{' '}
                {relay.upstream.ntripVersion.toUpperCase()} · {relay.downstream.mode}
              </div>
              <div className="muted table-subline mono">
                up {relay.upstream.host}:{relay.upstream.port}/{relay.upstream.mount} → down{' '}
                {relay.downstream.host}:{relay.downstream.port}/{relay.downstream.mount}
              </div>
              {relay.lastError && (
                <div className="inline-alert">
                  <AlertTriangle size={14} aria-hidden="true" /> {relay.lastError}
                </div>
              )}
              <div className="muted table-subline">
                Reconnect gần nhất:{' '}
                {relay.lastSession
                  ? `${formatLocal(relay.lastSession.startTs)} · ${
                      relay.lastSession.closeReason || relay.lastSession.result || 'đang chạy'
                    }`
                  : 'chưa có lịch sử relay'}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="detail-subhead">
        <h4>Kết nối hiện tại</h4>
        <span className="muted">{mountpoint.onlineConnections.length} online</span>
      </div>
      <OnlineConnections
        items={mountpoint.onlineConnections}
        empty="Không có kết nối caster online trên mountpoint này."
      />
    </article>
  );
}

function OverviewTab({ station }: { station: StationDetail }) {
  return (
    <>
      <StatusGrid station={station} />
      <dl className="facts">
        <div>
          <dt>Mã trạm</dt>
          <dd className="mono">{station.code}</dd>
        </div>
        <div>
          <dt>Loại trạm</dt>
          <dd>{station.station_type || '—'}</dd>
        </div>
        <div>
          <dt>Nguồn dữ liệu</dt>
          <dd>
            {station.source_type === 'relay_caster'
              ? 'NTRIP caster (relay)'
              : station.source_type === 'probe_client'
                ? 'NTRIP client (probe)'
                : station.source_type === 'caster_ingest'
                  ? 'NTRIP caster (ingest)'
                  : station.ntrip_mode === 'ntrip_client'
                    ? 'NTRIP client'
                    : 'Thủ công'}
          </dd>
        </div>
        <div>
          <dt>NTRIP</dt>
          <dd>
            {station.ntrip_version?.toUpperCase() ?? 'V1'} · {station.ntrip_mode ?? 'v1_noauth'}
          </dd>
        </div>
        <div>
          <dt>Mountpoint</dt>
          <dd className="mono">{station.mountpoint_count ?? 0}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{station.owner_name || station.owner_web_user_id || '—'}</dd>
        </div>
        <div>
          <dt>Receiver</dt>
          <dd>
            {station.receiver_type || '—'} · {station.receiver_sn || '—'}
          </dd>
        </div>
        <div>
          <dt>Antenna</dt>
          <dd>
            {station.antenna_type || '—'} · {station.antenna_height ?? '—'} m
          </dd>
        </div>
        <div>
          <dt>WGS84 lat/lon (1005)</dt>
          <dd className="mono">
            {station.reported_lat == null || station.reported_lon == null
              ? 'Chưa có message 1005/1006'
              : `${station.reported_lat.toFixed(6)}, ${station.reported_lon.toFixed(6)}`}
          </dd>
        </div>
        <div>
          <dt>VN2000 (TM 105°)</dt>
          <dd className="mono">
            {station.vn2000_easting == null || station.vn2000_northing == null
              ? '—'
              : `E ${station.vn2000_easting.toFixed(3)} · N ${station.vn2000_northing.toFixed(3)}`}
          </dd>
        </div>
        <div>
          <dt>ITRF spatial (ECEF)</dt>
          <dd className="mono">
            {station.itrf_x == null || station.itrf_y == null || station.itrf_z == null
              ? '—'
              : `X ${station.itrf_x.toFixed(3)} · Y ${station.itrf_y.toFixed(3)} · Z ${station.itrf_z.toFixed(3)}`}
          </dd>
        </div>
        <div>
          <dt>Vùng</dt>
          <dd>{station.region || '—'}</dd>
        </div>
        <div>
          <dt>Địa chỉ</dt>
          <dd>{station.address || '—'}</dd>
        </div>
        <div>
          <dt>Đơn vị thi công</dt>
          <dd>{station.contractor || '—'}</dd>
        </div>
        <div>
          <dt>Dữ liệu cuối</dt>
          <dd className="mono">{formatLocal(station.last_data_at)}</dd>
        </div>
        <div>
          <dt>Relay job</dt>
          <dd>
            {station.relay_job_name ?? '—'}
            {station.relay_upstream_host
              ? ` · ${station.relay_upstream_host}:${station.relay_upstream_port ?? ''}`
              : ''}
          </dd>
        </div>
        <div>
          <dt>Relay upstream host</dt>
          <dd className="mono">
            {station.relay_upstream_host
              ? `${station.relay_upstream_host}:${station.relay_upstream_port ?? ''}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Ghi chú</dt>
          <dd>{station.notes || '—'}</dd>
        </div>
      </dl>
      {station.reliability && <ReliabilityBlock reliability={station.reliability} />}
    </>
  );
}

function ConnectionTab({ stationId }: { stationId: number }) {
  const connections = useQuery({
    queryKey: ['station-connections', stationId],
    queryFn: () =>
      apiFetch<StationConnectionsResponse>(`/api/stations/${stationId}/connections`),
    refetchInterval: 15_000
  });
  const data = connections.data;
  const uptime = useQuery({
    queryKey: ['station-uptime', stationId],
    queryFn: async () => {
      const ranges = ['1d', '7d', '30d'] as const;
      return Promise.all(
        ranges.map((range) =>
          apiFetch<{
            range: string;
            uptimePct: number;
            buckets: Array<{
              timeouts: number;
              authErrors: number;
              proxyErrors: number;
              networkErrors: number;
            }>;
          }>(`/api/stations/${stationId}/uptime?range=${range}`)
        )
      );
    }
  });

  if (connections.isLoading) {
    return <div className="chart-empty">Đang tải thông tin kết nối...</div>;
  }
  if (connections.isError) {
    return (
      <EmptyState
        title="Không tải được thông tin kết nối"
        description={
          connections.error instanceof ApiClientError
            ? connections.error.message
            : 'Kiểm tra kết nối Node/caster.'
        }
        action={<Button onClick={() => connections.refetch()}>Thử lại</Button>}
      />
    );
  }
  if (!data) return null;

  return (
    <>
      <div className="quality-kpis">
        <div>
          <span className="muted">Mountpoint</span>
          <strong className="mono">{data.summary.mountpoints}</strong>
        </div>
        <div>
          <span className="muted">Relay job</span>
          <strong className="mono">{data.summary.relays}</strong>
        </div>
        <div>
          <span className="muted">Online</span>
          <strong className="mono">{data.summary.onlineConnections}</strong>
        </div>
      </div>

      <div className="quality-kpis">
        {(uptime.data ?? []).map((item) => {
          const errors = item.buckets.reduce(
            (sum, bucket) =>
              sum +
              bucket.timeouts +
              bucket.authErrors +
              bucket.proxyErrors +
              bucket.networkErrors,
            0
          );
          return (
            <div key={item.range}>
              <span className="muted">Uptime {item.range}</span>
              <strong className="mono">{item.uptimePct.toFixed(1)}%</strong>
              <small className="muted">{errors} lỗi</small>
            </div>
          );
        })}
      </div>

      {!data.casterAvailable && (
        <div className="inline-alert">
          <AlertTriangle size={14} aria-hidden="true" /> Không gọi được caster nội bộ; số kết nối
          online có thể chưa đầy đủ.
        </div>
      )}

      <div className="detail-subhead">
        <h4>
          <RadioTower size={16} aria-hidden="true" /> Mountpoint & relay
        </h4>
        <span className="muted">{formatLocal(data.generatedAt)}</span>
      </div>
      {data.mountpoints.length === 0 ? (
        <div className="table-state">Trạm chưa có mountpoint.</div>
      ) : (
        <div className="connection-sections">
          {data.mountpoints.map((mountpoint) => (
            <MountpointConnection mountpoint={mountpoint} key={mountpoint.id} />
          ))}
        </div>
      )}

      <div className="detail-subhead">
        <h4>
          <Link2 size={16} aria-hidden="true" /> Probe
        </h4>
        <span className="muted">{data.summary.probes} cấu hình</span>
      </div>
      {data.probes.length === 0 ? (
        <p className="muted">Trạm chưa cấu hình station probe.</p>
      ) : (
        <div className="connection-list">
          {data.probes.map((probe) => (
            <div className="connection-item" key={probe.id}>
              <span>
                <strong>Probe #{probe.id}</strong>
                <small className="muted">
                  Mountpoint {probe.mountpointId ?? '—'} · {probe.probeIntervalSec} giây
                </small>
              </span>
              <StatusBadge label={probe.enabled ? 'enabled' : 'disabled'} kind={probe.enabled ? 'ok' : 'neutral'} />
            </div>
          ))}
        </div>
      )}
      <div className="probe-note">
        <Clock3 size={14} aria-hidden="true" /> {data.probeHistory.message}
      </div>
    </>
  );
}

function MetadataTab({ stationId }: { stationId: number }) {
  const metadata = useQuery({
    queryKey: ['station-metadata', stationId],
    queryFn: () => apiFetch<StationMetadataResponse>(`/api/stations/${stationId}/metadata`),
    refetchInterval: 30_000
  });
  const data = metadata.data;

  if (metadata.isLoading) return <div className="chart-empty">Đang tải metadata...</div>;
  if (metadata.isError) {
    return (
      <EmptyState
        title="Không tải được metadata"
        description={
          metadata.error instanceof ApiClientError
            ? metadata.error.message
            : 'Kiểm tra kết nối Node/Go.'
        }
        action={<Button onClick={() => metadata.refetch()}>Thử lại</Button>}
      />
    );
  }
  if (!data) return null;

  return (
    <>
      <div className="detail-status-row">
        <span className="muted">Metadata status</span>
        <StatusBadge
          label={data.metadataStatus}
          kind={metadataKind(data.metadataStatus)}
        />
        <span className="muted">Cửa sổ {data.windowMinutes} phút</span>
      </div>

      <dl className="facts">
        <div>
          <dt>1005 Station ID</dt>
          <dd className="mono">{data.metadata.reportedStationId ?? '—'}</dd>
        </div>
        <div>
          <dt>1005/1006</dt>
          <dd>
            {data.metadata.has1005 ? 'Có 1005' : 'Thiếu 1005'} ·{' '}
            {data.metadata.has1006 ? 'Có ARP' : 'Thiếu ARP'}
          </dd>
        </div>
        <div>
          <dt>ARP ECEF (m)</dt>
          <dd className="mono">
            {data.metadata.arpX === null
              ? '—'
              : `${formatNumber(data.metadata.arpX)} / ${formatNumber(
                  data.metadata.arpY ?? 0
                )} / ${formatNumber(data.metadata.arpZ ?? 0)}`}
          </dd>
        </div>
        <div>
          <dt>ARP jump</dt>
          <dd className="mono">
            {data.metadata.arpDeltaM === null
              ? '—'
              : `${formatNumber(data.metadata.arpDeltaM)} m`}
          </dd>
        </div>
        <div>
          <dt>Antenna</dt>
          <dd>{data.metadata.antenna || '—'}</dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd className="mono">{formatNumber(data.bitrateBps)} bps</dd>
        </div>
        <div>
          <dt>Message rate</dt>
          <dd className="mono">{formatNumber(data.messageRatePerMinute)} / phút</dd>
        </div>
        <div>
          <dt>Dữ liệu cuối</dt>
          <dd className="mono">{formatLocal(data.metadata.lastSeenAt)}</dd>
        </div>
      </dl>

      <div className="detail-subhead">
        <h4>
          <Database size={16} aria-hidden="true" /> Message type
        </h4>
        <span className="muted">{data.messages.length} loại</span>
      </div>
      {data.messages.length === 0 ? (
        <p className="muted">Chưa có thống kê RTCM trong cửa sổ này.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="index-col">STT</th>
                <th>Type</th>
                <th className="align-right">Count</th>
                <th className="align-right">Bytes</th>
                <th className="align-right">Rate/phút</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.messages.map((message, index) => (
                <tr key={message.messageType}>
                  <td className="index-col">{index + 1}</td>
                  <td className="mono">{message.messageType}</td>
                  <td className="align-right mono">{formatNumber(message.count)}</td>
                  <td className="align-right mono">{formatNumber(message.bytes)}</td>
                  <td className="align-right mono">{formatNumber(message.ratePerMinute)}</td>
                  <td className="mono">{formatLocal(message.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.reliability && <ReliabilityBlock reliability={data.reliability} />}
    </>
  );
}

function HistoryTab({ stationId }: { stationId: number }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const from = useMemo(() => {
    const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);
  const history = useQuery({
    queryKey: ['station-history', stationId, from, page, pageSize],
    queryFn: () =>
      apiFetch<StationHistoryResponse>(
        `/api/stations/${stationId}/history?from=${encodeURIComponent(from)}&page=${page}&pageSize=${pageSize}`
      )
  });
  const data = history.data;
  const sourceEntries = data
    ? (Object.entries(data.sources) as Array<[string, number]>).filter(([, count]) => count > 0)
    : [];

  return (
    <>
      <div className="history-toolbar">
        <div className="history-range">
          {(['24h', '7d', '30d'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={`btn ghost small ${range === value ? 'active' : ''}`}
              onClick={() => {
                setRange(value);
                setPage(1);
              }}
            >
              {value === '24h' ? '24 giờ' : value === '7d' ? '7 ngày' : '30 ngày'}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => history.refetch()} loading={history.isFetching}>
          <RefreshCw size={16} aria-hidden="true" /> Tải lại
        </Button>
      </div>

      {sourceEntries.length > 0 && (
        <div className="source-summary">
          {sourceEntries.map(([source, count]) => (
            <StatusBadge key={source} label={`${source} ${count}`} kind={sourceKind(source)} />
          ))}
        </div>
      )}

      {history.isLoading ? (
        <div className="chart-empty">Đang tải lịch sử...</div>
      ) : history.isError ? (
        <EmptyState
          title="Không tải được lịch sử"
          description={
            history.error instanceof ApiClientError
              ? history.error.message
              : 'Kiểm tra kết nối DB runtime.'
          }
          action={<Button onClick={() => history.refetch()}>Thử lại</Button>}
        />
      ) : !data || data.items.length === 0 ? (
        <div className="table-state">Chưa có sự kiện trong khoảng thời gian này.</div>
      ) : (
        <div className="timeline">
          {data.items.map((event) => (
            <article className="timeline-item" key={event.id}>
              <div className={`timeline-dot ${event.source}`} />
              <div className="timeline-content">
                <div className="timeline-head">
                  <strong>{event.title}</strong>
                  <StatusBadge label={event.source} kind={sourceKind(event.source)} />
                </div>
                <p className="muted">{event.detail}</p>
                <span className="mono muted">{formatLocal(event.at)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
      <div className="probe-note">
        <HistoryIcon size={14} aria-hidden="true" />{' '}
        {data?.probeHistory.message ?? 'Chưa lưu lịch sử probe.'}
      </div>
    </>
  );
}

export function StationDetailDrawer({
  stationId,
  tab,
  onTabChange,
  onClose,
  onEdit
}: {
  stationId: number;
  tab: StationDetailTab;
  onTabChange: (tab: StationDetailTab) => void;
  onClose: () => void;
  onEdit: (station: StationDetail) => void;
}) {
  const { can } = useAuth();
  const detail = useQuery({
    queryKey: ['station-detail', stationId],
    queryFn: () => apiFetch<{ item: StationDetail }>(`/api/stations/${stationId}`),
    refetchInterval: 15_000
  });
  const station = detail.data?.item;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={station?.name ?? 'Chi tiết trạm'}
      description={station ? `${station.code} · #${station.id}` : `Trạm #${stationId}`}
      side="right"
      size="lg"
      footer={
        <>
          {station && can('stations', 'edit') && (
            <Button onClick={() => onEdit(station)}>
              <Pencil size={16} aria-hidden="true" /> Sửa
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <div className="chart-empty">Đang tải chi tiết trạm...</div>
      ) : detail.isError ? (
        <EmptyState
          title="Không mở được trạm"
          description={
            detail.error instanceof ApiClientError
              ? detail.error.message
              : 'Trạm không tồn tại hoặc ngoài phạm vi quyền.'
          }
          action={<Button onClick={() => detail.refetch()}>Thử lại</Button>}
        />
      ) : station ? (
        <>
          <StatusGrid station={station} />
          <Tabs value={tab} options={TABS} onChange={onTabChange} />
          {tab === 'overview' && <OverviewTab station={station} />}
          {tab === 'connection' && <ConnectionTab stationId={station.id} />}
          {tab === 'quality' &&
            (can('quality', 'view') ? (
              <>
                {station.reliability && <ReliabilityBlock reliability={station.reliability} />}
                <QualityPanel key={station.id} targetType="station" targetId={station.id} />
              </>
            ) : (
              <EmptyState
                title="Không có quyền xem chất lượng"
                description="Cần quyền quality.view để xem score, message type và cảnh báo RTCM."
              />
            ))}
          {tab === 'metadata' && <MetadataTab stationId={station.id} />}
          {tab === 'history' && <HistoryTab stationId={station.id} />}
        </>
      ) : null}
    </Modal>
  );
}
