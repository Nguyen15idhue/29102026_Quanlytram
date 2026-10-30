import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  KeyRound,
  Plus,
  Radio,
  RadioTower,
  RefreshCw,
  Unplug
} from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import type { AuditLog } from '../types';
import { Button, PageHeader, StatusBadge } from '../components/ui';

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

export function Dashboard() {
  const { user, can } = useAuth();
  const { snapshot, connected, revoked, refresh } = useRealtime();
  const summary = snapshot?.summary;
  const recentAudit = useQuery({
    queryKey: ['audit-logs', 'dashboard'],
    enabled: can('audit', 'view'),
    queryFn: () => apiFetch<{ items: AuditLog[] }>('/api/audit-logs?pageSize=5')
  });

  return (
    <section className="page">
      <PageHeader
        title="Dashboard"
        description="Tổng quan realtime hệ thống quản lý trạm CORS/NTRIP/RTCM."
        actions={
          <div className="toolbar">
            <StatusBadge
              label={revoked ? 'Phiên realtime bị thu hồi' : connected ? 'Realtime trực tuyến' : 'Đang kết nối lại'}
              kind={revoked ? 'error' : connected ? 'ok' : 'warn'}
            />
            <Button variant="ghost" size="sm" onClick={refresh} disabled={!connected}>
              <RefreshCw size={16} aria-hidden="true" /> Làm mới
            </Button>
          </div>
        }
      />

      <div className="kpi-strip">
        <div className="kpi">
          <span className="kpi-label">Trạm</span>
          <strong className="kpi-value">{summary?.stations ?? '—'}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">Relay job</span>
          <strong className="kpi-value">{summary?.relayTotal ?? '—'}</strong>
          <span className="muted kpi-sub">Streaming {summary?.relayStreaming ?? '—'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Kết nối caster</span>
          <strong className="kpi-value">{summary?.connections ?? '—'}</strong>
          <span className="muted kpi-sub">Listener bật {summary?.listeners ?? '—'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Cảnh báo mở</span>
          <strong className="kpi-value">{summary?.openAlerts ?? '—'}</strong>
          <span className="muted kpi-sub">
            Backoff {summary?.relayBackoff ?? '—'} · Lỗi {summary?.relayError ?? '—'}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="table-head">
          <div>
            <h2>Trạng thái relay realtime</h2>
            <p className="muted">
              Cập nhật {formatLocal(snapshot?.ts)} · Pending {summary?.relayPending ?? '—'}
            </p>
          </div>
          {can('alerts', 'view') && (
            <Link className="btn ghost small" to="/alerts">
              <AlertTriangle size={16} aria-hidden="true" /> Cảnh báo
            </Link>
          )}
        </div>
        {snapshot && snapshot.relays.length > 0 ? (
          <div className="realtime-list">
            {snapshot.relays.slice(0, 8).map((relay) => (
              <div className="realtime-row" key={relay.jobId}>
                <div>
                  <strong>{relay.name}</strong>
                  <div className="muted mono">
                    up {relay.bytesUp} · down {relay.bytesDown} · frame {relay.frames}
                  </div>
                </div>
                <StatusBadge
                  label={relay.state}
                  kind={
                    relay.state === 'streaming'
                      ? 'ok'
                      : relay.state === 'error'
                        ? 'error'
                        : relay.state === 'backoff' || relay.state === 'connecting'
                          ? 'warn'
                          : 'neutral'
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="table-state">
            {can('relay', 'view')
              ? 'Chưa có relay job hoặc dữ liệu realtime đang tải.'
              : 'Bạn không có quyền xem relay.'}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Vận hành nhanh</h2>
        <div className="quick-actions">
          {can('stations', 'add') && (
            <Link className="quick-action" to="/stations">
              <Plus size={18} aria-hidden="true" />
              <span>Thêm trạm</span>
              <RadioTower size={16} aria-hidden="true" />
            </Link>
          )}
          {can('relay', 'add') && (
            <Link className="quick-action" to="/relay-jobs">
              <Plus size={18} aria-hidden="true" />
              <span>Thêm relay job</span>
              <Radio size={16} aria-hidden="true" />
            </Link>
          )}
          {can('ntrip_accounts', 'add') && (
            <Link className="quick-action" to="/ntrip-accounts">
              <Plus size={18} aria-hidden="true" />
              <span>Thêm TK NTRIP</span>
              <KeyRound size={16} aria-hidden="true" />
            </Link>
          )}
          {can('connections', 'view') && (
            <Link className="quick-action" to="/caster">
              <Unplug size={18} aria-hidden="true" />
              <span>Kết nối caster</span>
              <Radio size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {can('audit', 'view') && (
        <div className="panel">
          <div className="table-head">
            <h2>Hoạt động gần đây</h2>
            <Link className="btn ghost small" to="/history?tab=audit">
              Xem audit
            </Link>
          </div>
          {recentAudit.data?.items.length ? (
            <div className="realtime-list">
              {recentAudit.data.items.map((log) => (
                <div className="realtime-row" key={log.id}>
                  <div>
                    <strong>{log.actorName || `#${log.actorId ?? '—'}`}</strong>
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

      <div className="panel">
        <h2>Phiên hiện tại</h2>
        <dl className="facts">
          <div>
            <dt>Tài khoản</dt>
            <dd>{user?.username}</dd>
          </div>
          <div>
            <dt>Vai trò</dt>
            <dd>
              {user?.role.name} ({user?.role.code})
            </dd>
          </div>
          <div>
            <dt>Phạm vi</dt>
            <dd>{user?.role.code === 'super_admin' ? 'Toàn hệ thống' : 'Theo phân quyền'}</dd>
          </div>
          <div>
            <dt>Giờ hệ thống</dt>
            <dd>{formatLocal(new Date().toISOString())}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
