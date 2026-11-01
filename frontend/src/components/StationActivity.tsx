import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useRealtime } from '../realtime/RealtimeProvider';
import type {
  StationActivityPoint,
  StationActivityRange,
  StationActivityResponse
} from '../types';
import { Button, EmptyState, Select, StatusBadge } from './ui';
import { formatNumber } from './charts';

function liveKind(state?: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'streaming') return 'ok';
  if (state === 'stale') return 'warn';
  if (state === 'error') return 'error';
  return 'neutral';
}

const RANGES: Array<{ value: StationActivityRange; label: string }> = [
  { value: '24h', label: '24 giờ' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' }
];

type MetricKey = 'satellites' | 'avgCnr' | 'msmEpochs' | 'gaps' | 'ageMs';

const METRICS: Array<{ value: MetricKey; label: string; unit: string }> = [
  { value: 'satellites', label: 'Số vệ tinh', unit: 'vệ tinh' },
  { value: 'avgCnr', label: 'C/N0 trung bình', unit: 'dBHz' },
  { value: 'msmEpochs', label: 'Epoch MSM', unit: '' },
  { value: 'gaps', label: 'Khoảng trống epoch', unit: '' },
  { value: 'ageMs', label: 'Độ trễ mẫu', unit: 'ms' }
];

function formatTime(value: string, range: StationActivityRange): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    ...(range === '24h' ? {} : { day: '2-digit', month: '2-digit' })
  }).format(date);
}

function metricValue(point: StationActivityPoint, metric: MetricKey): number | null {
  const value = point[metric];
  return value === null || !Number.isFinite(value) ? null : value;
}

function ActivityChart({
  points,
  metric,
  range,
  from,
  to
}: {
  points: StationActivityPoint[];
  metric: MetricKey;
  range: StationActivityRange;
  from: string;
  to: string;
}) {
  const values = useMemo(
    () =>
      points
        .map((point) => ({ at: new Date(point.at).getTime(), value: metricValue(point, metric) }))
        .filter((point): point is { at: number; value: number } => point.value !== null),
    [points, metric]
  );
  if (values.length === 0) {
    return <div className="chart-empty">Chưa có dữ liệu chất lượng trong khoảng thời gian này.</div>;
  }
  const width = 900;
  const height = 180;
  const pad = { left: 36, right: 10, top: 12, bottom: 10 };
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const span = Math.max(1, end - start);
  const highRaw = Math.max(...values.map((point) => point.value), 1);
  const high = Math.ceil(highRaw / 10) * 10 || 10;
  const mid = high / 2;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (at: number) => pad.left + ((at - start) / span) * plotWidth;
  const y = (value: number) =>
    pad.top + plotHeight - (Math.max(0, Math.min(high, value)) / high) * plotHeight;
  const line = values
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.at).toFixed(2)} ${y(point.value).toFixed(2)}`)
    .join(' ');
  const area = `${line} L ${x(values[values.length - 1].at).toFixed(2)} ${(
    pad.top + plotHeight
  ).toFixed(2)} L ${x(values[0].at).toFixed(2)} ${(pad.top + plotHeight).toFixed(2)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    label:
      ratio === 1
        ? 'now'
        : formatTime(new Date(start + ratio * span).toISOString(), range)
  }));

  return (
    <div className="activity-chart">
      <div className="activity-yaxis">
        <span>{formatNumber(high)}</span>
        <span>{formatNumber(mid)}</span>
        <span>0</span>
      </div>
      <div className="activity-plot">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Đồ thị uptime">
          {[0, 0.5, 1].map((ratio) => (
            <line
              key={ratio}
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotHeight * ratio}
              y2={pad.top + plotHeight * ratio}
              stroke="var(--border)"
              strokeDasharray={ratio === 1 ? undefined : '3 4'}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill="var(--accent-soft)" opacity="0.55" />
          <path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="activity-xaxis">
          {ticks.map((tick) => (
            <span key={tick.ratio}>{tick.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionTimeline({ data }: { data: StationActivityResponse }) {
  if (data.segments.length === 0) {
    return <div className="activity-empty">Chưa có dữ liệu kết nối.</div>;
  }
  const span = Math.max(1, new Date(data.to).getTime() - new Date(data.from).getTime());
  return (
    <div
      className="activity-connection"
      role="img"
      aria-label={`Dòng thời gian kết nối ${formatNumber(data.uptimePct)} phần trăm online`}
    >
      {data.segments.map((segment) => {
        const duration = Math.max(0, new Date(segment.to).getTime() - new Date(segment.from).getTime());
        return (
          <span
            key={`${segment.from}-${segment.to}`}
            className={`activity-slot ${segment.status}`}
            style={{ flexGrow: Math.max(duration / span, 0.0001) }}
            title={`${formatTime(segment.from, data.range)} → ${formatTime(
              segment.to,
              data.range
            )} · ${segment.status === 'up' ? 'online' : 'mất kết nối'}`}
          />
        );
      })}
    </div>
  );
}

export function StationActivityPanel({
  stationId,
  onOpenHistory
}: {
  stationId: number;
  onOpenHistory: () => void;
}) {
  const [range, setRange] = useState<StationActivityRange>('24h');
  const [metric, setMetric] = useState<MetricKey>('satellites');
  const queryClient = useQueryClient();
  const { quality, connected } = useRealtime();
  const live = quality.find(
    (item) =>
      item.targetType === 'station' &&
      item.targetId === stationId &&
      item.direction === 'ingest'
  );
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (!live?.ts) return;
    const now = Date.now();
    if (now - lastRefresh.current < 10_000) return;
    lastRefresh.current = now;
    void queryClient.invalidateQueries({ queryKey: ['station-activity', stationId, range] });
  }, [live?.ts, queryClient, stationId, range]);
  const activity = useQuery({
    queryKey: ['station-activity', stationId, range],
    queryFn: () =>
      apiFetch<StationActivityResponse>(`/api/stations/${stationId}/activity?range=${range}`),
    refetchInterval: 60_000
  });
  const data = activity.data;
  const selectedMetric = METRICS.find((item) => item.value === metric) ?? METRICS[0];
  const latest = data
    ? [...data.series].reverse().find((point) => metricValue(point, metric) !== null)
    : null;
  const latestValue = latest ? metricValue(latest, metric) : null;

  if (activity.isLoading) {
    return <div className="chart-empty">Đang tải hoạt động trạm...</div>;
  }
  if (activity.isError) {
    return (
      <EmptyState
        title="Không tải được hoạt động trạm"
        description={
          activity.error instanceof ApiClientError
            ? activity.error.message
            : 'Kiểm tra kết nối Node/Go.'
        }
        action={<Button onClick={() => activity.refetch()}>Thử lại</Button>}
      />
    );
  }
  if (!data) return null;

  return (
    <div className="activity-panel">
      <div className="activity-head">
        <div className="activity-summary">
          <span>
            Online <strong className="mono">{formatNumber(data.uptimePct)}%</strong>
          </span>
          <span className="muted">·</span>
          <span>
            <strong className="mono">{data.events.length}</strong> sự kiện
          </span>
          {live && <StatusBadge label={live.state} kind={liveKind(live.state)} />}
          <span className="muted">{connected ? 'socket live' : 'socket offline'}</span>
          <button type="button" className="link-btn" onClick={onOpenHistory}>
            Xem lịch sử kết nối <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
        <div className="history-range">
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
      </div>

      <section className="activity-block">
        <h3 className="activity-label">
          <Activity size={14} aria-hidden="true" /> Sự kiện
        </h3>
        {data.events.length === 0 ? (
          <div className="activity-empty">Không có sự kiện trong khoảng thời gian đã chọn.</div>
        ) : (
          <div className="activity-events">
            {data.events.map((event) => (
              <div className="activity-event" key={event.id}>
                <span>
                  <strong>Mất kết nối</strong>{' '}
                  <span className="muted">
                    {event.source === 'relay' ? 'Relay' : 'Caster'} · {event.reason || 'unknown'}
                  </span>
                </span>
                <span className="mono muted">
                  {formatTime(event.at, data.range)} · {formatNumber(event.durationSec)}s
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="activity-block">
        <h3 className="activity-label">Kết nối</h3>
        <ConnectionTimeline data={data} />
      </section>

      <section className="activity-block">
        <div className="activity-chart-head">
          <h3 className="activity-label">Uptime</h3>
          <div className="activity-chart-controls">
            <Select
              aria-label="Chọn chỉ số uptime"
              value={metric}
              onChange={(event) => setMetric(event.target.value as MetricKey)}
            >
              {METRICS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <span className="muted mono">
              {latestValue === null
                ? '—'
                : `${formatNumber(latestValue)}${selectedMetric.unit ? ` ${selectedMetric.unit}` : ''}`}
            </span>
          </div>
        </div>
        <ActivityChart
          points={data.series}
          metric={metric}
          range={data.range}
          from={data.from}
          to={data.to}
        />
      </section>
    </div>
  );
}
