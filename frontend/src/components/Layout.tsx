import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Quản lý CORS</strong>
            <small>MVP</small>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          {can('stations', 'view') && <NavLink to="/stations">Trạm</NavLink>}
          {can('mountpoints', 'view') && <NavLink to="/mountpoints">Mountpoint</NavLink>}
          {can('relay', 'view') && <NavLink to="/relay-jobs">Relay</NavLink>}
          {can('ntrip_accounts', 'view') && <NavLink to="/ntrip-accounts">TK NTRIP</NavLink>}
          {can('web_users', 'view') && <NavLink to="/web-users">Người dùng web</NavLink>}
          {can('roles', 'view') && <NavLink to="/roles">Vai trò & quyền</NavLink>}
        </nav>
        <div className="sidebar-foot">
          <span>Phase 3</span>
          <span className="dot" aria-hidden="true" />
          <span>Quản trị</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <strong>{user?.displayName}</strong>
            <span className="muted"> · {user?.role.name}</span>
          </div>
          <button type="button" className="btn ghost" onClick={handleLogout}>
            Đăng xuất
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
