import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { KeyRound, Plus, Radio, RadioTower } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/ui';

interface CountResponse {
  total: number;
}

export function Dashboard() {
  const { user, can } = useAuth();
  const localTime = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date());

  const stations = useQuery({
    queryKey: ['stations', 'count'],
    queryFn: () => apiFetch<CountResponse>('/api/stations?pageSize=1'),
    enabled: can('stations', 'view')
  });
  const relay = useQuery({
    queryKey: ['relay-jobs', 'count'],
    queryFn: () => apiFetch<CountResponse>('/api/relay-jobs?pageSize=1'),
    enabled: can('relay', 'view')
  });
  const ntrip = useQuery({
    queryKey: ['ntrip-accounts', 'count'],
    queryFn: () => apiFetch<CountResponse>('/api/ntrip-accounts?pageSize=1'),
    enabled: can('ntrip_accounts', 'view')
  });
  const users = useQuery({
    queryKey: ['web-users', 'count'],
    queryFn: () => apiFetch<CountResponse>('/api/web-users?pageSize=1'),
    enabled: can('web_users', 'view')
  });

  return (
    <section className="page">
      <PageHeader
        title="Dashboard"
        description="Tổng quan hệ thống quản lý trạm CORS/NTRIP/RTCM."
      />

      <div className="kpi-strip">
        <div className="kpi">
          <span className="kpi-label">Trạm</span>
          <strong className="kpi-value">{stations.data?.total ?? '—'}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">Relay job</span>
          <strong className="kpi-value">{relay.data?.total ?? '—'}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">Tài khoản NTRIP</span>
          <strong className="kpi-value">{ntrip.data?.total ?? '—'}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">Người dùng web</span>
          <strong className="kpi-value">{users.data?.total ?? '—'}</strong>
        </div>
      </div>

      <div className="panel">
        <h2>Thao tác nhanh</h2>
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
        </div>
      </div>

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
            <dd>{localTime}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
