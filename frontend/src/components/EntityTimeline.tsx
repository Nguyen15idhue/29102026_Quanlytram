import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import type {
  EntityTimelineResponse,
  TimelineBucket,
  TimelineRange,
  TimelineStatus
} from '../types';
import { Button, EmptyState, Select } from './ui';
import { TimeSeriesChart, formatNumber } from './charts';

export type EntityTimelineKind = 'station' | 'relay';
type Direction = 'upstream' | 'downstream';

interface TimelineSegment {
  from: string;
  to: string;
  status: TimelineStatus;
  seconds: number;
}

const RANGES: Array<{ value: TimelineRange; label: string }> = [
  { value: '1h', label: '1 giờ' },
  { value: '24h', label: '24 giờ' },
  { value: '7d', label: '7 ngày' },
  { value: '1m', label: '1 tháng' }
];

const STATUS_LABEL: Record<TimelineStatus, string> = {
  online: 'online',
  offline: 'offline',
  no_data: 'không có dữ liệu',
  none: 'trước khi tạo'
};

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  if (value < 86400) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  return `${Math.floor(value / 86400)}d ${Math.floor((value % 86400) / 3600)}h`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function mergeBuckets(buckets: TimelineBucket[]): TimelineSegment[] {
  const merged: Array<{ from: string; to: string; status: TimelineStatus }> = [];
  for (const bucket of buckets) {
    const last = merged[merged.length - 1];
    if (last && last.status === bucket.status) {
      last.to = bucket.to;
    } else {
      merged.push({ from: bucket.from, to: bucket.to, status: bucket.status });
    }
  }
  return merged.map((segment) => ({
    ...segment,
    seconds: Math.max(
      0,
      Math.round((new Date(segment.to).getTime() - new Date(segment.from).getTime()) / 1000)
    )
  }));
}

function TimelineBar({
  segments,
  active,
  onActive
}: {
  segments: TimelineSegment[];
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.seconds, 0) || 1;
  return (
    <div className="timeline-bar" role="img" aria-label="Dòng thời gian trạng thái dữ liệu">
      {segments.map((segment) => {
        const key = `${segment.from}-${segment.to}`;
        return (
          <span
            key={key}
            className={`timeline-segment ${segment.status} ${active === key ? 'active' : ''}`}
            style={{ flexGrow: Math.max(segment.seconds / total, 0.0001) }}
            onMouseEnter={() => onActive(key)}
            onMouseLeave={() => onActive(null)}
            title={`${formatTime(segment.from)} → ${formatTime(segment.to)} · ${
              STATUS_LABEL[segment.status]
            }`}
          />
        );
      })}
    </div>
  );
}

export function EntityTimelinePanel({
  kind,
  id
}: {
  kind: EntityTimelineKind;
  id: number;
}) {
  const isRelay = kind === 'relay';
  const [range, setRange] = useState<TimelineRange>('24h');
  const [direction, setDirection] = useState<Direction>('upstream');
  const [active, setActive] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  useEffect(() => {
    setVisibleCount(10);
    setActive(null);
  }, [range, direction, id, kind]);
  const query = useQuery({
    queryKey: ['entity-timeline', kind, id, range, direction],
    queryFn: () =>
      apiFetch<EntityTimelineResponse>(
        isRelay
          ? `/api/relay-jobs/${id}/timeline?range=${range}&direction=${direction}`
          : `/api/stations/${id}/timeline?range=${range}`
      ),
    refetchInterval: 60_000
  });
  const data = query.data;
  const segments = useMemo(() => (data ? mergeBuckets(data.buckets) : []), [data]);
  const activeSegment = active
    ? segments.find((segment) => `${segment.from}-${segment.to}` === active) ?? null
    : null;
  const orderedSegments = useMemo(() => [...segments].reverse(), [segments]);
  const visibleSegments = orderedSegments.slice(0, visibleCount);

  if (query.isLoading) {
    return <div className="chart-empty">Đang tải dòng thời gian...</div>;
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Không tải được dòng thời gian"
        description={
          query.error instanceof ApiClientError
            ? query.error.message
            : 'Kiểm tra kết nối Node/Go.'
        }
        action={<Button onClick={() => query.refetch()}>Thử lại</Button>}
      />
    );
  }
  if (!data) return null;

  const totalSec = data.onlineSec + data.offlineSec + data.noDataSec;
  const onlinePct = totalSec > 0 ? (data.onlineSec / totalSec) * 100 : null;
  const from = new Date(data.rangeFrom).getTime();
  const to = new Date(data.to).getTime();
  const span = Math.max(1, to - from);
  const activeMid = activeSegment
    ? ((new Date(activeSegment.from).getTime() +
        new Date(activeSegment.to).getTime()) /
        2 -
        from) /
      span
    : 0;

  const chartSeries = {
    satellites: data.series.map((point) => ({ at: point.at, value: point.satellites ?? 0 })),
    ageMs: data.series.map((point) => ({ at: point.at, value: point.ageMs ?? 0 })),
    avgCnr: data.series.map((point) => ({ at: point.at, value: point.avgCnr ?? 0 }))
  };

  return (
    <div className="entity-timeline">
      <div className="timeline-toolbar">
        <div className="timeline-ranges">
          {RANGES.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`btn ghost small ${range === item.value ? 'active' : ''}`}
              onClick={() => setRange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="timeline-actions">
          {isRelay && (
            <label className="timeline-filter">
              <span className="muted">Luồng</span>
              <Select
                aria-label="Chọn luồng dữ liệu"
                value={direction}
                onChange={(event) => setDirection(event.target.value as Direction)}
              >
                <option value="upstream">Nguồn (upstream)</option>
                <option value="downstream">Đích (downstream)</option>
              </Select>
            </label>
          )}
          <Button variant="ghost" onClick={() => query.refetch()} loading={query.isFetching}>
            <RefreshCw size={16} aria-hidden="true" /> Tải lại
          </Button>
        </div>
      </div>

      <div className="timeline-bar-wrap">
        <TimelineBar segments={segments} active={active} onActive={setActive} />
        {activeSegment && (
          <div className="timeline-tooltip" style={{ left: `${activeMid * 100}%` }}>
            <strong>{STATUS_LABEL[activeSegment.status]}</strong>
            <span className="mono">
              {formatTime(activeSegment.from)} → {formatTime(activeSegment.to)}
            </span>
            <span className="muted">{formatDuration(activeSegment.seconds)}</span>
          </div>
        )}
      </div>

      <div className="timeline-legend">
        <span className="legend-item">
          <i className="legend-dot online" /> online
        </span>
        <span className="legend-item">
          <i className="legend-dot offline" /> offline
        </span>
        <span className="legend-item">
          <i className="legend-dot no_data" /> không có dữ liệu
        </span>
        <span className="legend-item">
          <i className="legend-dot none" /> trước khi tạo
        </span>
      </div>

      <div className="timeline-summary">
        <div>
          <span className="muted">Tỷ lệ online</span>
          <strong className="mono">{onlinePct === null ? '—' : `${formatNumber(onlinePct)}%`}</strong>
        </div>
        <div>
          <span className="muted">Online</span>
          <strong className="mono">{formatDuration(data.onlineSec)}</strong>
        </div>
        <div>
          <span className="muted">Offline</span>
          <strong className="mono">{formatDuration(data.offlineSec)}</strong>
        </div>
        <div>
          <span className="muted">Không có dữ liệu</span>
          <strong className="mono">{formatDuration(data.noDataSec)}</strong>
        </div>
      </div>

      <div className="timeline-segments">
        {visibleSegments.map((segment) => {
          const key = `${segment.from}-${segment.to}`;
          return (
            <button
              type="button"
              key={`${key}-row`}
              className={`timeline-segment-row ${active === key ? 'active' : ''}`}
              onMouseEnter={() => setActive(key)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(key)}
            >
              <i className={`legend-dot ${segment.status}`} />
              <span className="mono">
                {formatTime(segment.from)} → {formatTime(segment.to)}
              </span>
              <span className="muted">{STATUS_LABEL[segment.status]}</span>
              <span className="mono">{formatDuration(segment.seconds)}</span>
            </button>
          );
        })}
      </div>
      {visibleCount < orderedSegments.length && (
        <button
          type="button"
          className="btn ghost small timeline-more"
          onClick={() => setVisibleCount((count) => count + 10)}
        >
          Xem thêm 10 bản ghi
        </button>
      )}

      <div className="timeline-charts">
        <TimeSeriesChart
          points={chartSeries.satellites}
          from={data.rangeFrom}
          to={data.to}
          label="Số vệ tinh"
          unit="vệ tinh"
          integer
        />
        <TimeSeriesChart
          points={chartSeries.ageMs}
          from={data.rangeFrom}
          to={data.to}
          label="Độ trễ"
          unit="ms"
        />
        <TimeSeriesChart
          points={chartSeries.avgCnr}
          from={data.rangeFrom}
          to={data.to}
          label="C/N0 trung bình"
          unit="dBHz"
        />
      </div>

      <div className="timeline-foot muted">
        <Activity size={14} aria-hidden="true" />
        Tạo lúc {data.createdAt ? formatTime(data.createdAt) : '—'} · độ phân giải{' '}
        {formatDuration(data.bucketSec)}
      </div>
    </div>
  );
}
