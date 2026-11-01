import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { Button, PageHeader, StatusBadge } from '../../components/ui';

type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown';

interface HealthResponse {
  status: HealthStatus;
  generatedAt: string;
  cacheTtlSec: number;
  cached: boolean;
  node: {
    status: HealthStatus;
    uptimeSec: number;
    pid: number;
    nodeVersion: string;
    cpuPercent: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    heapPercent: number;
    eventLoopLagMs: number;
    socketClients: number;
  };
  host: {
    status: HealthStatus;
    platform: string;
    release: string;
    architecture: string;
    cpuCount: number;
    cpuPercent: number;
    loadavg: number[] | null;
    loadavgReason: string | null;
    uptimeSec: number;
    memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number };
    disk:
      | {
          status: HealthStatus;
          totalBytes: number;
          usedBytes: number;
          freeBytes: number;
          usedPercent: number;
        }
      | { status: HealthStatus; reason: string };
    network: { status: HealthStatus; reason: string };
  };
  mysql: {
    status: HealthStatus;
    latencyMs: number;
    schemaVersion: number | null;
    pool: {
      totalConnections: number | null;
      freeConnections: number | null;
      queue: number | null;
      connectionLimit: number | null;
    } | null;
    error?: string;
  };
  go: {
    status: HealthStatus;
    reachable: boolean;
    latencyMs: number;
    error: string | null;
    quality: {
      queueDepth?: number;
      queueSize?: number;
      dropped?: number;
      parseErrors?: number;
      targets?: number;
      alertsOpen?: number;
      storeDrops?: number;
      time?: string;
      status?: string;
    } | null;
    relayJobs: number | null;
    casterConnections: number | null;
    casterListeners: number | null;
  };
}

function kind(status: HealthStatus): 'ok' | 'warn' | 'error' | 'neutral' {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  if (status === 'error') return 'error';
  return 'neutral';
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const seconds = Math.floor(value);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

function formatLocal(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function Card({
  title,
  status,
  note,
  children
}: {
  title: string;
  status: HealthStatus;
  note: string;
  children: ReactNode;
}) {
  return (
    <article className="health-card">
      <header>
        <h2>{title}</h2>
        <StatusBadge label={status} kind={kind(status)} />
      </header>
      {children}
      <p className="health-note">{note}</p>
    </article>
  );
}

export function HealthTab() {
  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiFetch<HealthResponse>('/api/system/health'),
    refetchInterval: 12_000
  });
  const data = health.data;

  return (
    <>
      <PageHeader
        title="System Health"
        description="Tình trạng VPS, Node, MySQL và Go; số liệu được cache ngắn để không ảnh hưởng relay/caster."
        actions={
          <Button variant="ghost" onClick={() => health.refetch()} loading={health.isFetching}>
            <RefreshCw size={16} aria-hidden="true" /> Tải lại
          </Button>
        }
      />

      {health.isLoading ? (
        <div className="panel table-state">Đang thu thập số liệu...</div>
      ) : health.isError || !data ? (
        <div className="panel table-state error">Không tải được System Health.</div>
      ) : (
        <>
          <div className="health-banner">
            <div>
              <span className="muted">Trạng thái tổng</span>
              <div className="health-overall">
                <Activity size={18} aria-hidden="true" />
                <strong>{data.status}</strong>
                <StatusBadge label={data.cached ? 'cached' : 'fresh'} kind="info" />
              </div>
            </div>
            <div className="muted">
              Cập nhật {formatLocal(data.generatedAt)} · cache {data.cacheTtlSec}s · tự làm mới 12s
            </div>
          </div>

          <div className="health-grid">
            <Card
              title="Node"
              status={data.node.status}
              note="Cảnh báo heap ≥80% hoặc event-loop ≥200ms; lỗi ≥92% hoặc ≥1000ms."
            >
              <dl className="health-facts">
                <div><dt>Uptime</dt><dd>{formatDuration(data.node.uptimeSec)}</dd></div>
                <div><dt>CPU process</dt><dd className="mono">{data.node.cpuPercent.toFixed(1)}%</dd></div>
                <div><dt>RSS</dt><dd className="mono">{formatBytes(data.node.rssBytes)}</dd></div>
                <div>
                  <dt>Heap</dt>
                  <dd className="mono">
                    {formatBytes(data.node.heapUsedBytes)} / {formatBytes(data.node.heapTotalBytes)} ·{' '}
                    {data.node.heapPercent.toFixed(1)}%
                  </dd>
                </div>
                <div><dt>Event-loop lag</dt><dd className="mono">{data.node.eventLoopLagMs.toFixed(1)} ms</dd></div>
                <div><dt>Socket clients</dt><dd className="mono">{data.node.socketClients}</dd></div>
                <div><dt>PID</dt><dd className="mono">{data.node.pid}</dd></div>
                <div><dt>Node</dt><dd className="mono">{data.node.nodeVersion}</dd></div>
              </dl>
            </Card>

            <Card
              title="Host / VPS"
              status={data.host.status}
              note="Cảnh báo RAM hoặc đĩa ≥90%; lỗi ≥97%. Metric không hỗ trợ được ghi rõ, không bịa số."
            >
              <dl className="health-facts">
                <div><dt>Nền tảng</dt><dd>{data.host.platform} {data.host.release} ({data.host.architecture})</dd></div>
                <div><dt>CPU</dt><dd className="mono">{data.host.cpuCount} core · {data.host.cpuPercent.toFixed(1)}%</dd></div>
                <div>
                  <dt>Load average</dt>
                  <dd className="mono">
                    {data.host.loadavg ? data.host.loadavg.join(' / ') : data.host.loadavgReason ?? '—'}
                  </dd>
                </div>
                <div><dt>Uptime</dt><dd>{formatDuration(data.host.uptimeSec)}</dd></div>
                <div>
                  <dt>RAM</dt>
                  <dd className="mono">
                    {formatBytes(data.host.memory.usedBytes)} / {formatBytes(data.host.memory.totalBytes)} ·{' '}
                    {data.host.memory.usedPercent.toFixed(1)}%
                  </dd>
                </div>
                <div>
                  <dt>Đĩa</dt>
                  <dd className="mono">
                    {'usedPercent' in data.host.disk
                      ? `${formatBytes(data.host.disk.usedBytes)} / ${formatBytes(data.host.disk.totalBytes)} · ${data.host.disk.usedPercent.toFixed(1)}%`
                      : data.host.disk.reason}
                  </dd>
                </div>
                <div><dt>Network</dt><dd>{data.host.network.reason}</dd></div>
              </dl>
            </Card>

            <Card
              title="MySQL"
              status={data.mysql.status}
              note="Cảnh báo latency ≥300ms; lỗi ≥1000ms hoặc không kết nối. Không trả DSN/secret."
            >
              {data.mysql.error ? (
                <div className="inline-alert">{data.mysql.error}</div>
              ) : null}
              <dl className="health-facts">
                <div><dt>Ping latency</dt><dd className="mono">{data.mysql.latencyMs.toFixed(1)} ms</dd></div>
                <div><dt>Schema admin</dt><dd className="mono">{data.mysql.schemaVersion ?? '—'}</dd></div>
                <div><dt>Pool total</dt><dd className="mono">{data.mysql.pool?.totalConnections ?? '—'}</dd></div>
                <div><dt>Pool free</dt><dd className="mono">{data.mysql.pool?.freeConnections ?? '—'}</dd></div>
                <div><dt>Hàng đợi</dt><dd className="mono">{data.mysql.pool?.queue ?? '—'}</dd></div>
                <div><dt>Giới hạn pool</dt><dd className="mono">{data.mysql.pool?.connectionLimit ?? '—'}</dd></div>
              </dl>
            </Card>

            <Card
              title="Go runtime"
              status={data.go.status}
              note="Lỗi khi timeout/HMAC; quality analyzer disabled = cảnh báo. Không nằm trên đường byte RTCM."
            >
              {data.go.error ? <div className="inline-alert">{data.go.error}</div> : null}
              <dl className="health-facts">
                <div><dt>Reachable</dt><dd>{data.go.reachable ? 'Có' : 'Không'}</dd></div>
                <div><dt>Latency</dt><dd className="mono">{data.go.latencyMs.toFixed(1)} ms</dd></div>
                <div><dt>Relay job</dt><dd className="mono">{data.go.relayJobs ?? '—'}</dd></div>
                <div><dt>Caster online</dt><dd className="mono">{data.go.casterConnections ?? '—'}</dd></div>
                <div><dt>Listener</dt><dd className="mono">{data.go.casterListeners ?? '—'}</dd></div>
                <div><dt>Quality queue</dt><dd className="mono">{data.go.quality?.queueDepth ?? '—'} / {data.go.quality?.queueSize ?? '—'}</dd></div>
                <div><dt>Targets</dt><dd className="mono">{data.go.quality?.targets ?? '—'}</dd></div>
                <div><dt>Alert mở</dt><dd className="mono">{data.go.quality?.alertsOpen ?? '—'}</dd></div>
                <div><dt>Dropped</dt><dd className="mono">{data.go.quality?.dropped ?? '—'}</dd></div>
                <div><dt>Parse errors</dt><dd className="mono">{data.go.quality?.parseErrors ?? '—'}</dd></div>
                <div><dt>Store drops</dt><dd className="mono">{data.go.quality?.storeDrops ?? '—'}</dd></div>
              </dl>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
