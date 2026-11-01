import { useId, useState } from 'react';

interface LineChartProps {
  values: number[];
  label: string;
  min?: number;
  max?: number;
  height?: number;
  suffix?: string;
}

export function LineChart({
  values,
  label,
  min,
  max,
  height = 64,
  suffix = ''
}: LineChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length === 0) {
    return <div className="chart-empty">Chưa có dữ liệu</div>;
  }
  const width = 320;
  const pad = 4;
  const low = min ?? Math.min(...points);
  const high = max ?? Math.max(...points);
  const span = high - low || 1;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - low) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${(pad + (points.length - 1) * step).toFixed(2)},${
    height - pad
  }`;
  const last = points[points.length - 1];
  return (
    <figure className="chart">
      <figcaption>
        <span>{label}</span>
        <strong className="mono">
          {formatNumber(last)}
          {suffix}
        </strong>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: ${formatNumber(last)}${suffix}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </figure>
  );
}

interface BarChartProps {
  data: { label: string; value: number }[];
  label: string;
  suffix?: string;
  limit?: number;
}

export function BarChart({ data, label, suffix = '', limit = 12 }: BarChartProps) {
  const items = [...data].sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.length === 0) {
    return <div className="chart-empty">Chưa có dữ liệu</div>;
  }
  return (
    <figure className="bar-chart" aria-label={label}>
      <figcaption>{label}</figcaption>
      <div className="bar-chart-rows">
        {items.map((item) => (
          <div className="bar-chart-row" key={item.label}>
            <span className="mono bar-label">{item.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </span>
            <span className="mono bar-value">
              {formatNumber(item.value)}
              {suffix}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function ScoreDial({ score, state }: { score: number; state: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="score-dial" aria-label={`Điểm chất lượng ${clamped} trên 100`}>
      <svg viewBox="0 0 84 84" role="img">
        <circle cx="42" cy="42" r={radius} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 42 42)"
        />
      </svg>
      <div>
        <strong className="mono">{clamped}</strong>
        <span className="muted">{state}</span>
      </div>
    </div>
  );
}

export interface TimeSeriesPoint {
  at: string;
  value: number | null;
}

export function TimeSeriesChart({
  points,
  from,
  to,
  label,
  unit = '',
  height = 150,
  integer = false
}: {
  points: TimeSeriesPoint[];
  from: string;
  to: string;
  label: string;
  unit?: string;
  height?: number;
  integer?: boolean;
}) {
  const display = integer ? formatInteger : formatNumber;
  const [hover, setHover] = useState<{
    at: number;
    value: number;
    ratio: number;
  } | null>(null);
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const span = Math.max(1, end - start);
  const values = points
    .map((point) => ({ at: new Date(point.at).getTime(), value: point.value }))
    .filter((point) => Number.isFinite(point.at));
  const numericPoints = values.filter(
    (point): point is { at: number; value: number } =>
      point.value !== null && Number.isFinite(point.value)
  );
  if (numericPoints.length === 0) {
    return <div className="chart-empty">Chưa có dữ liệu trong khoảng này.</div>;
  }
  const width = 900;
  const pad = { left: 42, right: 10, top: 12, bottom: 22 };
  const highRaw = Math.max(...numericPoints.map((point) => point.value), 1);
  const high = Math.ceil(highRaw / 10) * 10 || 10;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (at: number) => pad.left + ((at - start) / span) * plotWidth;
  const y = (value: number) =>
    pad.top + plotHeight - (Math.max(0, Math.min(high, value)) / high) * plotHeight;
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of values) {
    if (point.value === null || !Number.isFinite(point.value)) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(`${x(point.at).toFixed(2)},${y(point.value).toFixed(2)}`);
  }
  if (current.length > 1) segments.push(current.join(' '));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    label:
      ratio === 1
        ? 'now'
        : new Intl.DateTimeFormat('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
            ...(span > 86400_000 ? { day: '2-digit', month: '2-digit' } : {})
          }).format(new Date(start + ratio * span))
  }));
  const last = numericPoints[numericPoints.length - 1];
  return (
    <figure className="time-chart" aria-label={label}>
      <figcaption>
        <span>{label}</span>
        <strong className="mono">
          {display(last.value)}
          {unit ? ` ${unit}` : ''}
        </strong>
      </figcaption>
      <div className="time-chart-plot">
        <div className="time-chart-yaxis">
          <span>{display(high)}</span>
          <span>{display(high / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="time-chart-canvas"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(
              1,
              Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
            );
            const targetAt = start + ratio * span;
            let nearest = numericPoints[0];
            for (const point of numericPoints) {
              if (Math.abs(point.at - targetAt) < Math.abs(nearest.at - targetAt)) {
                nearest = point;
              }
            }
            setHover({
              at: nearest.at,
              value: nearest.value,
              ratio: (nearest.at - start) / span
            });
          }}
        >
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
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
            {segments.map((segment, index) => (
              <polyline
                key={index}
                points={segment}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hover && (
              <>
                <line
                  x1={x(hover.at)}
                  x2={x(hover.at)}
                  y1={pad.top}
                  y2={pad.top + plotHeight}
                  stroke="var(--muted)"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={x(hover.at)}
                  cy={y(hover.value)}
                  r="3.5"
                  fill="var(--accent)"
                />
              </>
            )}
          </svg>
          {hover && (
            <div
              className="time-chart-tooltip"
              style={{ left: `${Math.min(94, Math.max(6, hover.ratio * 100))}%` }}
            >
              <span className="mono">
                {new Intl.DateTimeFormat('vi-VN', {
                  timeZone: 'Asia/Ho_Chi_Minh',
                  dateStyle: 'short',
                  timeStyle: 'short'
                }).format(new Date(hover.at))}
              </span>
              <strong className="mono">
                {display(hover.value)}
                {unit ? ` ${unit}` : ''}
              </strong>
            </div>
          )}
          <div className="time-chart-xaxis">
            {ticks.map((tick) => (
              <span key={tick.ratio}>{tick.label}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000) return new Intl.NumberFormat('vi-VN').format(Math.round(value));
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}

export interface SkyPoint {
  azimuth: number;
  elevation: number;
  system: string;
  satellite: number;
  band?: string;
  cnr?: number;
}

export interface SignalCnrPoint {
  system: string;
  satellite: number;
  signal: number;
  band: string;
  cnr: number;
}

export function systemPrefix(system: string): string {
  switch (system) {
    case 'GPS':
      return 'G';
    case 'GLONASS':
      return 'R';
    case 'Galileo':
      return 'E';
    case 'BeiDou':
      return 'C';
    case 'QZSS':
      return 'J';
    case 'SBAS':
      return 'S';
    default:
      return system.slice(0, 1);
  }
}

export function bandColor(band: string | undefined): string {
  switch (band) {
    case 'L1':
    case 'G1':
    case 'E1':
    case 'B1':
      return 'var(--band-1)';
    case 'L2':
    case 'G2':
    case 'E5a':
    case 'B2':
      return 'var(--band-2)';
    case 'L5':
    case 'G3':
    case 'E5b':
    case 'B3':
      return 'var(--band-3)';
    case 'B1C':
    case 'E5a+b':
      return 'var(--band-4)';
    case 'B2a':
    case 'E6':
      return 'var(--band-5)';
    case 'B2b':
      return 'var(--band-6)';
    default:
      return 'var(--muted)';
  }
}

export function SkyPlot({ points = [], reason }: { points?: SkyPoint[]; reason?: string }) {
  const size = 340;
  const center = size / 2;
  const radius = 142;
  const ring = (elevation: number) => (radius * (90 - elevation)) / 90;
  return (
    <figure className="sky-plot" aria-label="Sky Plot vệ tinh">
      <svg viewBox={`0 0 ${size} ${size}`} role="img">
        {[0, 30, 60].map((elevation) => (
          <circle
            key={elevation}
            cx={center}
            cy={center}
            r={ring(elevation)}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}
        <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke="var(--border)" />
        <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke="var(--border)" />
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((degree) => {
          const angle = (degree * Math.PI) / 180;
          const x = center + (radius + 16) * Math.sin(angle);
          const y = center - (radius + 16) * Math.cos(angle);
          return (
            <text key={degree} x={x} y={y + 3} textAnchor="middle" className="sky-label">
              {degree}
            </text>
          );
        })}
        <text x={center} y={14} textAnchor="middle" className="sky-label">N</text>
        <text x={size - 4} y={center + 4} textAnchor="end" className="sky-label">E</text>
        <text x={center} y={size - 4} textAnchor="middle" className="sky-label">S</text>
        <text x={4} y={center + 4} className="sky-label">W</text>
        {points.map((point) => {
          const distance = ring(point.elevation);
          const angle = (point.azimuth * Math.PI) / 180;
          const x = center + distance * Math.sin(angle);
          const y = center - distance * Math.cos(angle);
          return (
            <g key={`${point.system}-${point.satellite}`}>
              <circle cx={x} cy={y} r="6" fill={bandColor(point.band)} opacity="0.9" />
              <text x={x + 8} y={y + 3} className="sky-label">
                {systemPrefix(point.system)}
                {point.satellite}
              </text>
            </g>
          );
        })}
      </svg>
      {points.length === 0 && (
        <figcaption className="muted">
          {reason || 'Chưa có ephemeris để tính azimuth/elevation.'}
        </figcaption>
      )}
    </figure>
  );
}

export function SnrBars({ items = [] }: { items?: SignalCnrPoint[] }) {
  if (items.length === 0) {
    return <div className="chart-empty">Chưa có CNR theo vệ tinh/băng.</div>;
  }
  const grouped = new Map<
    string,
    { label: string; system: string; satellite: number; signals: SignalCnrPoint[] }
  >();
  for (const item of items) {
    const key = `${item.system}:${item.satellite}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: `${systemPrefix(item.system)}${item.satellite}`,
        system: item.system,
        satellite: item.satellite,
        signals: []
      });
    }
    grouped.get(key)!.signals.push(item);
  }
  const groups = [...grouped.values()]
    .sort((a, b) => a.system.localeCompare(b.system) || a.satellite - b.satellite)
    .slice(0, 36);
  const max = Math.max(60, ...items.map((item) => item.cnr));
  const width = 900;
  const height = 210;
  const pad = { left: 36, right: 10, top: 12, bottom: 26 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const groupWidth = plotWidth / groups.length;
  const barWidth = Math.max(2, Math.min(5, (groupWidth - 4) / 6));
  return (
    <figure className="snr-bars" aria-label="SNR theo vệ tinh và băng">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
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
        {groups.map((group, groupIndex) => {
          const baseX = pad.left + groupIndex * groupWidth + groupWidth / 2;
          return (
            <g key={`${group.system}-${group.satellite}`}>
              {group.signals.map((signal, signalIndex) => {
                const barHeight = (Math.min(max, signal.cnr) / max) * plotHeight;
                const x =
                  baseX -
                  (group.signals.length * barWidth) / 2 +
                  signalIndex * barWidth;
                return (
                  <rect
                    key={`${signal.signal}`}
                    x={x}
                    y={pad.top + plotHeight - barHeight}
                    width={Math.max(1, barWidth - 1)}
                    height={barHeight}
                    fill={bandColor(signal.band)}
                  >
                    <title>
                      {group.system} {group.satellite} · {signal.band} ·{' '}
                      {formatNumber(signal.cnr)} dBHz
                    </title>
                  </rect>
                );
              })}
              {groupIndex % 3 === 0 && (
                <text
                  x={baseX}
                  y={height - 8}
                  textAnchor="middle"
                  className="sky-label"
                >
                  {group.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="snr-yaxis">
        <span>{formatNumber(max)}</span>
        <span>{formatNumber(max / 2)}</span>
        <span>0</span>
      </div>
    </figure>
  );
}
