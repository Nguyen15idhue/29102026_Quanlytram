import { useQuery } from '@tanstack/react-query';
import { Pencil, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { StationDetail, StationReliability, StationTransportStatus } from '../types';
import { Button, EmptyState, Modal } from './ui';
import { QualityPanel } from './QualityPanel';
import { EntityHistoryPanel } from './EntityHistory';
import { EntityTimelinePanel } from './EntityTimeline';
import { EntityStatusHeader } from './EntityStatusHeader';
import { EntityDetail, type EntityDetailTab } from './EntityDetail';

export type StationDetailTab = EntityDetailTab;

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
  if (value === 'no_data') return 'warn';
  if (value === 'offline' || value === 'error') return 'error';
  return 'neutral';
}

function transportLabel(value: StationTransportStatus): string {
  if (value === 'online') return 'online';
  if (value === 'offline') return 'offline';
  if (value === 'no_data') return 'không có dữ liệu';
  if (value === 'error') return 'error';
  return '—';
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

function OverviewTab({ station }: { station: StationDetail }) {
  return (
    <>
      <dl className="facts">
        <div>
          <dt>ID trạm</dt>
          <dd className="mono">#{station.id}</dd>
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
      description={station ? `${station.name} · #${station.id}` : `Trạm #${stationId}`}
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
        <EntityDetail
          tab={tab}
          onTabChange={onTabChange}
          health={
            <EntityStatusHeader
              badges={[
                {
                  label: 'Trạng thái',
                  value: transportLabel(station.transportStatus),
                  kind: transportKind(station.transportStatus)
                }
              ]}
            />
          }
          sections={{
            overview: <OverviewTab station={station} />,
            data: <EntityTimelinePanel kind="station" id={station.id} />,
            quality: can('quality', 'view') ? (
              <QualityPanel key={station.id} targetType="station" targetId={station.id} />
            ) : (
              <EmptyState
                title="Không có quyền xem chất lượng"
                description="Cần quyền quality.view để xem sky plot, CNR và điểm chất lượng."
              />
            ),
            history: <EntityHistoryPanel kind="station" id={station.id} />
          }}
        />
      ) : null}
    </Modal>
  );
}
