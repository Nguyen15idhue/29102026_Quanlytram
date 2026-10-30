import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { apiFetch, ApiClientError } from '../api/client';
import type { Permission, User } from '../types';

interface AuthContextValue {
  user: User | null;
  permissions: Permission[];
  csrfToken: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (module: string, action: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: User;
  csrfToken: string;
  permissions: Permission[];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<MeResponse>('/api/auth/me')
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setPermissions(data.permissions);
        setCsrfToken(data.csrfToken);
      })
      .catch((err) => {
        if (!active) return;
        if (!(err instanceof ApiClientError && err.status === 401)) {
          console.error(err);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<MeResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    setUser(data.user);
    setPermissions(data.permissions);
    setCsrfToken(data.csrfToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST', csrfToken });
    } finally {
      setUser(null);
      setPermissions([]);
      setCsrfToken(null);
    }
  }, [csrfToken]);

  const can = useCallback(
    (module: string, action: string) =>
      permissions.some(
        (permission) => permission.code === `${module}.${action}` && permission.scope !== 'none'
      ),
    [permissions]
  );

  const value = useMemo(
    () => ({ user, permissions, csrfToken, loading, login, logout, can }),
    [user, permissions, csrfToken, loading, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
