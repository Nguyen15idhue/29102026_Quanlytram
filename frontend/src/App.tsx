import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Roles } from './pages/Roles';
import { Stations } from './pages/Stations';
import { OnlineList } from './pages/OnlineList';
import { Mountpoints } from './pages/Mountpoints';
import { NtripAccounts } from './pages/NtripAccounts';
import { RelayJobs } from './pages/RelayJobs';
import { Caster } from './pages/Caster';
import { WebUsers } from './pages/WebUsers';
import { Companies } from './pages/Companies';
import { Alerts } from './pages/Alerts';
import { History } from './pages/History';
import { Profile } from './pages/Profile';
import { System } from './pages/System';
import { SystemMapConfig } from './pages/SystemMapConfig';

const UnifiedMap = lazy(() =>
  import('./pages/UnifiedMap').then((module) => ({ default: module.UnifiedMap }))
);

const Guide = lazy(() =>
  import('./pages/Guide').then((module) => ({ default: module.Guide }))
);

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Đang tải...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export function App() {
  const { user, loading } = useAuth();
  return (
    <Suspense fallback={<div className="page-loading">Đang tải bản đồ...</div>}>
      <Routes>
        <Route
          path="/login"
          element={loading ? null : user ? <Navigate to="/" replace /> : <Login />}
        />
        <Route element={<Protected />}>
          <Route index element={<Dashboard />} />
          <Route path="/stations" element={<Stations />} />
          <Route path="/stations/map" element={<Navigate to="/map?layer=stations" replace />} />
          <Route path="/online/map" element={<Navigate to="/map?layer=online" replace />} />
          <Route path="/stations/:stationId" element={<Stations />} />
          <Route path="/map" element={<UnifiedMap />} />
          <Route path="/online" element={<OnlineList />} />
          <Route path="/mountpoints" element={<Mountpoints />} />
          <Route path="/relay-jobs" element={<RelayJobs />} />
          <Route path="/history" element={<History />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/caster" element={<Caster />} />
          <Route path="/ntrip-accounts" element={<NtripAccounts />} />
          <Route path="/web-users" element={<WebUsers />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/system" element={<System />} />
          <Route path="/system/health" element={<Navigate to="/system?tab=health" replace />} />
          <Route path="/system/map-config" element={<SystemMapConfig />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/huong-dan" element={<Navigate to="/guide" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
