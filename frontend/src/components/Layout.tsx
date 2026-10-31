import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
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
  '/map': 'Bản đồ vận hành',
  '/online': 'Danh sách online',
  '/mountpoints': 'Mountpoint',
  '/relay-jobs': 'Relay',
  '/history': 'Lịch sử relay',
  '/alerts': 'Cảnh báo',
  '/caster': 'Caster',
  '/ntrip-accounts': 'Tài khoản NTRIP',
  '/web-users': 'Người dùng web',
  '/roles': 'Vai trò & quyền',
  '/system/health': 'System Health',
  '/profile': 'Trang cá nhân'
};

export function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const pageTitle = /^\/stations\/\d+$/.test(location.pathname)
    ? 'Chi tiết trạm'
    : titles[location.pathname] ?? 'Quản lý CORS';

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
        { to: '/stations', label: 'Danh sách trạm', icon: RadioTower, show: can('stations', 'view') }
      ]
    },
    {
      label: 'Bản đồ',
      items: [
        { to: '/map', label: 'Bản đồ vận hành', icon: MapPinned, show: can('stations', 'view') },
        { to: '/online', label: 'Danh sách online', icon: List, show: can('connections', 'view') }
      ]
    },
    {
      label: 'CORS',
      items: [
        { to: '/mountpoints', label: 'Mountpoint', icon: Network, show: can('mountpoints', 'view') },
        { to: '/caster', label: 'Listener', icon: Antenna, show: can('caster', 'view') }
      ]
    },
    {
      label: 'Tài khoản',
      items: [
        {
          to: '/ntrip-accounts',
          label: 'Tài khoản NTRIP',
          icon: KeyRound,
          show: can('ntrip_accounts', 'view')
        }
      ]
    },
    {
      label: 'Relay',
      items: [{ to: '/relay-jobs', label: 'Relay jobs', icon: Radio, show: can('relay', 'view') }]
    },
    {
      label: 'Hệ thống',
      items: [
        {
          to: '/system/health',
          label: 'Sức khỏe',
          icon: Activity,
          show: can('system_health', 'view')
        },
        { to: '/alerts', label: 'Cảnh báo', icon: Bell, show: can('alerts', 'view') },
        { to: '/history', label: 'Lịch sử', icon: History, show: can('relay', 'view') || can('audit', 'view') },
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
                      end={item.to === '/' || item.to === '/mountpoints'}
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
              <strong>{pageTitle}</strong>
              <span className="muted"> · {user?.role.name}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <NavLink className="topbar-user" to="/profile">
              {user?.displayName}
            </NavLink>
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
