import { useId } from 'react';

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
}

export function SkyPlot({ points = [], reason }: { points?: SkyPoint[]; reason?: string }) {
  const size = 180;
  const center = size / 2;
  const radius = 76;
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
          />
        ))}
        <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke="var(--border)" />
        <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke="var(--border)" />
        <text x={center} y={12} textAnchor="middle" className="sky-label">N</text>
        <text x={size - 6} y={center + 4} textAnchor="end" className="sky-label">E</text>
        <text x={center} y={size - 4} textAnchor="middle" className="sky-label">S</text>
        <text x={6} y={center + 4} className="sky-label">W</text>
        {points.map((point) => {
          const distance = ring(point.elevation);
          const angle = (point.azimuth * Math.PI) / 180;
          const x = center + distance * Math.sin(angle);
          const y = center - distance * Math.cos(angle);
          return (
            <g key={`${point.system}-${point.satellite}`}>
              <circle cx={x} cy={y} r="3.5" fill="var(--accent)" />
              <text x={x + 5} y={y + 3} className="sky-label">
                {point.system}{point.satellite}
              </text>
            </g>
          );
        })}
      </svg>
      {points.length === 0 && (
        <figcaption className="muted">{reason || 'Chưa có ephemeris để tính azimuth/elevation.'}</figcaption>
      )}
    </figure>
  );
}
