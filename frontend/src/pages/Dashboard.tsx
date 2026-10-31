import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import { Button, PageHeader, StatusBadge } from '../components/ui';

type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown';

interface OpsImpact {
  station: { id: number; code: string; name: string } | null;
  mountpoints: Array<{ id: number; name: string }>;
  relays: Array<{
    id: number;
    name: string;
    desiredRevision: number;
    appliedRevision: number | null;
    runtimeState: string;
    lastError: string | null;
  }>;
  listeners: Array<{ id: number; name: string; port: number }>;
  onlineAccounts: Array<{ id: number; username: string }>;
  onlineConnections: number;
  note: string | null;
}

interface OpsIncident {
  source: 'admin' | 'quality';
  id: number;
  severity: string;
  level: string;
  targetType: string;
  targetId: number | null;
  mountpointId: number | null;
  title: string;
  message: string;
  status: string;
  createdAt: string;
  lastSeen: string;
  impact: OpsImpact | null;
}

interface OpsDashboard {
  generatedAt: string;
  windowMinutes: number;
  summary: {
    stations: number;
    mountpoints: number;
    relayTotal: number;
    relayStreaming: number;
    relayIssues: number;
    onlineConnections: number;
    onlineAccounts: number;
    openAlerts: number;
    qualityOpen: number;
    incidents: number;
    goAvailable: boolean;
    casterAvailable: boolean;
  };
  health: {
    status: HealthStatus;
    node: HealthStatus;
    host: HealthStatus;
    mysql: HealthStatus;
    go: HealthStatus;
    generatedAt?: string;
  } | null;
  incidents: OpsIncident[];
  recentAudit: Array<{
    id: number;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
}

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

function severityKind(value: string): 'ok' | 'warn' | 'error' | 'neutral' | 'info' {
  if (value === 'critical') return 'error';
  if (value === 'warning' || value === 'major') return 'warn';
  if (value === 'info') return 'info';
  return 'neutral';
}

function healthKind(value: HealthStatus): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'ok') return 'ok';
  if (value === 'warn') return 'warn';
  if (value === 'error') return 'error';
  return 'neutral';
}

function impactText(incident: OpsIncident): string {
  const impact = incident.impact;
  if (!impact) return 'Chưa xác định ảnh hưởng';
  const parts: string[] = [];
  if (impact.station) parts.push(`${impact.station.code} · ${impact.station.name}`);
  else if (impact.note) parts.push(impact.note);
  if (impact.mountpoints.length > 0) {
    parts.push(`MP ${impact.mountpoints.map((item) => item.name).slice(0, 3).join(', ')}`);
  }
  if (impact.relays.length > 0) {
    const relay = impact.relays[0];
    parts.push(
      `Relay ${relay.name} (${relay.desiredRevision}/${relay.appliedRevision ?? '—'})`
    );
  }
  if (impact.onlineConnections > 0 || impact.onlineAccounts.length > 0) {
    parts.push(
      `${impact.onlineConnections} online · ${impact.onlineAccounts.length} tài khoản`
    );
  }
  return parts.join(' · ') || 'Không có đối tượng trực tiếp';
}

export function Dashboard() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { connected, revoked } = useRealtime();
  const ops = useQuery({
    queryKey: ['ops-dashboard', 60],
    queryFn: () => apiFetch<OpsDashboard>('/api/ops/dashboard?window=60'),
    refetchInterval: 10_000
  });
  const data = ops.data;
  const summary = data?.summary;

  function openIncident(incident: OpsIncident) {
    if (incident.targetType === 'relay_job' && incident.targetId) {
      navigate(`/relay-jobs?job=${incident.targetId}`);
      return;
    }
    if (incident.targetType === 'station' && incident.targetId) {
      navigate(`/stations/${incident.targetId}`);
      return;
    }
    if (incident.impact?.station) {
      navigate(`/stations/${incident.impact.station.id}`);
      return;
    }
    if (incident.targetType === 'caster') {
      navigate('/caster');
      return;
    }
    navigate('/system/health');
  }

  return (
    <section className="page">
      <PageHeader
        title="Dashboard"
        description="Tổng quan hệ thống, sức khỏe dịch vụ và sự cố đang ảnh hưởng đến trạm/tài khoản."
        actions={
          <div className="toolbar">
            <StatusBadge
              label={revoked ? 'Phiên realtime bị thu hồi' : connected ? 'Realtime trực tuyến' : 'Đang kết nối lại'}
              kind={revoked ? 'error' : connected ? 'ok' : 'warn'}
            />
            <Button variant="ghost" size="sm" onClick={() => ops.refetch()} loading={ops.isFetching}>
              <RefreshCw size={16} aria-hidden="true" /> Làm mới
            </Button>
          </div>
        }
      />

      {ops.isLoading ? (
        <div className="panel table-state">Đang tải dashboard...</div>
      ) : ops.isError || !data ? (
        <div className="panel table-state error">Không tải được dashboard vận hành.</div>
      ) : (
        <>
          <div className="kpi-strip">
            <div className="kpi kpi-overview">
              <span className="kpi-label">Trạm / Mountpoint</span>
              <strong className="kpi-value">{summary?.stations ?? 0}</strong>
              <span className="muted kpi-sub">{summary?.mountpoints ?? 0} mountpoint</span>
            </div>
            <div className="kpi kpi-relay">
              <span className="kpi-label">Relay</span>
              <strong className="kpi-value">{summary?.relayStreaming ?? 0}</strong>
              <span className="muted kpi-sub">
                / {summary?.relayTotal ?? 0} job · {summary?.relayIssues ?? 0} cần xử lý
              </span>
            </div>
            <div className="kpi kpi-online">
              <span className="kpi-label">Online</span>
              <strong className="kpi-value">{summary?.onlineConnections ?? 0}</strong>
              <span className="muted kpi-sub">{summary?.onlineAccounts ?? 0} tài khoản</span>
            </div>
            <div className="kpi kpi-incidents">
              <span className="kpi-label">Sự cố mở</span>
              <strong className="kpi-value">
                {(summary?.openAlerts ?? 0) + (summary?.qualityOpen ?? 0)}
              </strong>
              <span className="muted kpi-sub">
                {summary?.openAlerts ?? 0} hệ thống · {summary?.qualityOpen ?? 0} quality
              </span>
            </div>
          </div>

          <div className="panel dashboard-zone zone-health">
            <div className="table-head">
              <div>
                <h2>Sức khỏe hệ thống</h2>
                <p className="muted">
                  Cập nhật {formatLocal(data.generatedAt)} · cửa sổ {data.windowMinutes} phút
                </p>
              </div>
              {can('settings', 'view') && (
                <Link className="btn ghost small" to="/system/health">
                  Mở System Health <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              )}
            </div>
            {data.health ? (
              <div className="ops-health">
                <div>
                  <span className="muted">Node</span>
                  <StatusBadge label={data.health.node} kind={healthKind(data.health.node)} />
                </div>
                <div>
                  <span className="muted">Host</span>
                  <StatusBadge label={data.health.host} kind={healthKind(data.health.host)} />
                </div>
                <div>
                  <span className="muted">MySQL</span>
                  <StatusBadge label={data.health.mysql} kind={healthKind(data.health.mysql)} />
                </div>
                <div>
                  <span className="muted">Go</span>
                  <StatusBadge label={data.health.go} kind={healthKind(data.health.go)} />
                </div>
                <div>
                  <span className="muted">Tổng</span>
                  <StatusBadge label={data.health.status} kind={healthKind(data.health.status)} />
                </div>
              </div>
            ) : (
              <div className="table-state">Không có quyền xem sức khỏe hệ thống.</div>
            )}
          </div>

          <div className="panel dashboard-zone zone-incidents">
            <div className="table-head">
              <div>
                <h2>Sự cố cần xử lý</h2>
                <p className="muted">
                  Critical/major trước · {data.incidents.length} mục hiển thị
                </p>
              </div>
              {can('alerts', 'view') && (
                <Link className="btn ghost small" to="/alerts">
                  Mở cảnh báo
                </Link>
              )}
            </div>
            {data.incidents.length === 0 ? (
              <div className="table-state">Không có sự cố mở.</div>
            ) : (
              <div className="incident-list">
                {data.incidents.slice(0, 10).map((incident) => (
                  <button
                    type="button"
                    className="incident-item"
                    key={`${incident.source}:${incident.id}`}
                    onClick={() => openIncident(incident)}
                  >
                    <span className="incident-icon">
                      <AlertTriangle size={16} aria-hidden="true" />
                    </span>
                    <span className="incident-body">
                      <span className="incident-head">
                        <strong>{incident.title}</strong>
                        <span className="incident-badges">
                          <StatusBadge
                            label={incident.level}
                            kind={severityKind(incident.severity)}
                          />
                          <StatusBadge label={incident.source} kind="neutral" />
                        </span>
                      </span>
                      <span className="muted incident-message">{incident.message || '—'}</span>
                      <span className="incident-impact">{impactText(incident)}</span>
                      <span className="muted mono incident-time">
                        {formatLocal(incident.lastSeen || incident.createdAt)}
                      </span>
                    </span>
                    <ArrowUpRight size={16} className="muted" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {can('audit', 'view') && (
            <div className="panel dashboard-zone zone-activity">
              <div className="table-head">
                <h2>Hoạt động gần đây</h2>
                <Link className="btn ghost small" to="/history?tab=audit">
                  Xem audit
                </Link>
              </div>
              {data.recentAudit.length > 0 ? (
                <div className="realtime-list">
                  {data.recentAudit.map((log) => (
                    <div className="realtime-row" key={log.id}>
                      <div>
                        <strong>{log.actorName || 'Hệ thống'}</strong>
                        <div className="muted table-subline">
                          {log.action} · {log.entityType}
                          {log.entityId ? ` #${log.entityId}` : ''}
                        </div>
                      </div>
                      <span className="mono muted">{formatLocal(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="table-state">Chưa có hoạt động gần đây.</div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
