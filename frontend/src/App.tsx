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
import { Alerts } from './pages/Alerts';
import { History } from './pages/History';
import { Profile } from './pages/Profile';

const StationMap = lazy(() =>
  import('./pages/StationMap').then((module) => ({ default: module.StationMap }))
);
const OnlineMap = lazy(() =>
  import('./pages/OnlineMap').then((module) => ({ default: module.OnlineMap }))
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
          <Route path="/stations/map" element={<StationMap />} />
          <Route path="/online/map" element={<OnlineMap />} />
          <Route path="/online" element={<OnlineList />} />
          <Route path="/mountpoints" element={<Mountpoints />} />
          <Route path="/relay-jobs" element={<RelayJobs />} />
          <Route path="/history" element={<History />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/caster" element={<Caster />} />
          <Route path="/ntrip-accounts" element={<NtripAccounts />} />
          <Route path="/web-users" element={<WebUsers />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
