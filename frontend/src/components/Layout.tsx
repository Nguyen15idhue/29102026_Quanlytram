import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Radio,
  RadioTower,
  ShieldCheck,
  Users,
  X
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { IconButton } from './ui';
import { ThemeToggle } from './ThemeToggle';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/stations': 'Trạm',
  '/mountpoints': 'Mountpoint',
  '/relay-jobs': 'Relay',
  '/ntrip-accounts': 'Tài khoản NTRIP',
  '/web-users': 'Người dùng web',
  '/roles': 'Vai trò & quyền'
};

export function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { to: '/stations', label: 'Trạm', icon: RadioTower, show: can('stations', 'view') },
    { to: '/mountpoints', label: 'Mountpoint', icon: Network, show: can('mountpoints', 'view') },
    { to: '/relay-jobs', label: 'Relay', icon: Radio, show: can('relay', 'view') },
    { to: '/ntrip-accounts', label: 'TK NTRIP', icon: KeyRound, show: can('ntrip_accounts', 'view') },
    { to: '/web-users', label: 'Người dùng web', icon: Users, show: can('web_users', 'view') },
    { to: '/roles', label: 'Vai trò & quyền', icon: ShieldCheck, show: can('roles', 'view') }
  ];

  return (
    <div className="shell">
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <RadioTower size={24} className="brand-icon" aria-hidden="true" />
          <div>
            <strong>Quản lý CORS</strong>
            <small>NTRIP / RTCM</small>
          </div>
        </div>
        <nav className="nav" aria-label="Điều hướng chính">
          {nav
            .filter((item) => item.show)
            .map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
        </nav>
        <div className="sidebar-foot">
          <span>Phase 3.5</span>
          <span className="dot" aria-hidden="true" />
          <span>UI foundation</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <IconButton label={open ? 'Đóng menu' : 'Mở menu'} className="menu-toggle" onClick={() => setOpen(!open)}>
              {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </IconButton>
            <div>
              <strong>{titles[location.pathname] ?? 'Quản lý CORS'}</strong>
              <span className="muted"> · {user?.role.name}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="topbar-user">{user?.displayName}</span>
            <IconButton label="Đăng xuất" onClick={handleLogout}>
              <LogOut size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
