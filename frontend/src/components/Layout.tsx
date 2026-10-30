import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Antenna,
  Bell,
  History,
  KeyRound,
  LayoutDashboard,
  List,
  LogOut,
  MapPinned,
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
  '/stations': 'Danh sách trạm',
  '/stations/map': 'Bản đồ trạm',
  '/online': 'Danh sách online',
  '/online/map': 'Bản đồ online',
  '/mountpoints': 'Mountpoint',
  '/relay-jobs': 'Relay',
  '/history': 'Lịch sử relay',
  '/alerts': 'Cảnh báo',
  '/caster': 'Caster',
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

  const navGroups = [
    {
      label: 'Tổng quan',
      items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true }]
    },
    {
      label: 'Trạm',
      items: [
        { to: '/stations/map', label: 'Bản đồ trạm', icon: MapPinned, show: can('stations', 'view') },
        { to: '/stations', label: 'Danh sách trạm', icon: RadioTower, show: can('stations', 'view') }
      ]
    },
    {
      label: 'CORS',
      items: [
        { to: '/online/map', label: 'Bản đồ online', icon: MapPinned, show: can('connections', 'view') },
        { to: '/online', label: 'Danh sách online', icon: List, show: can('connections', 'view') },
        { to: '/caster', label: 'Caster', icon: Antenna, show: can('settings', 'view') },
        { to: '/ntrip-accounts', label: 'Tài khoản NTRIP', icon: KeyRound, show: can('ntrip_accounts', 'view') },
        { to: '/mountpoints', label: 'Mountpoint', icon: Network, show: can('mountpoints', 'view') }
      ]
    },
    {
      label: 'Relay',
      items: [{ to: '/relay-jobs', label: 'Relay', icon: Radio, show: can('relay', 'view') }]
    },
    {
      label: 'Hệ thống',
      items: [
        { to: '/history', label: 'Lịch sử', icon: History, show: can('relay', 'view') || can('audit', 'view') },
        { to: '/alerts', label: 'Cảnh báo', icon: Bell, show: can('alerts', 'view') },
        { to: '/web-users', label: 'Người dùng', icon: Users, show: can('web_users', 'view') },
        { to: '/roles', label: 'Phân quyền', icon: ShieldCheck, show: can('roles', 'view') }
      ]
    }
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
          {navGroups.map((group) => {
            const items = group.items.filter((item) => item.show);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {items.map((item) => {
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
              </div>
            );
          })}
        </nav>
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
