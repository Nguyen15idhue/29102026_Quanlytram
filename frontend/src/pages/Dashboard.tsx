import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

export function Dashboard() {
  const { user, can } = useAuth();
  const localTime = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date());

  const stations = useQuery({
    queryKey: ['stations', 'count'],
    queryFn: () => apiFetch<{ total: number }>('/api/stations?pageSize=1'),
    enabled: can('stations', 'view')
  });
  const users = useQuery({
    queryKey: ['web-users', 'count'],
    queryFn: () => apiFetch<{ total: number }>('/api/web-users?pageSize=1'),
    enabled: can('web_users', 'view')
  });
  const roles = useQuery({
    queryKey: ['roles', 'count'],
    queryFn: () => apiFetch<{ items: unknown[] }>('/api/roles'),
    enabled: can('roles', 'view')
  });

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Tổng quan hệ thống quản lý trạm.</p>
        </div>
      </header>

      <div className="cards">
        <article className="card">
          <span className="card-label">Trạm</span>
          <strong className="card-value">{stations.data?.total ?? '—'}</strong>
          <span className="muted">Trong phạm vi quyền</span>
        </article>
        <article className="card">
          <span className="card-label">Người dùng web</span>
          <strong className="card-value">{users.data?.total ?? '—'}</strong>
          <span className="muted">Tài khoản quản trị</span>
        </article>
        <article className="card">
          <span className="card-label">Vai trò</span>
          <strong className="card-value">{roles.data?.items.length ?? '—'}</strong>
          <span className="muted">Role đang cấu hình</span>
        </article>
      </div>

      <article className="panel">
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
      </article>
    </section>
  );
}
