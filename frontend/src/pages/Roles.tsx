import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Role, Scope } from '../types';

interface RoleList {
  items: Role[];
}

interface PermissionRow {
  code: string;
  module: string;
  action: string;
  description: string;
  scope: Scope;
}

interface RolePermissions {
  role: Role;
  permissions: PermissionRow[];
}

export function Roles() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [error, setError] = useState('');
  const [newRole, setNewRole] = useState({ code: '', name: '', level: 20, description: '' });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleList>('/api/roles')
  });

  useEffect(() => {
    if (selectedId === null && roles.data?.items.length) {
      setSelectedId(roles.data.items[0].id);
    }
  }, [roles.data, selectedId]);

  const selected = roles.data?.items.find((role) => role.id === selectedId) ?? null;

  const detail = useQuery({
    queryKey: ['role-permissions', selectedId],
    queryFn: () => apiFetch<RolePermissions>(`/api/roles/${selectedId}/permissions`),
    enabled: selectedId !== null
  });

  useEffect(() => {
    if (!detail.data) return;
    const next: Record<string, Scope> = {};
    for (const permission of detail.data.permissions) next[permission.code] = permission.scope;
    setScopes(next);
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/roles/${selectedId}/permissions`, {
        method: 'PUT',
        csrfToken,
        body: {
          permissions: Object.entries(scopes).map(([code, scope]) => ({ code, scope }))
        }
      }),
    onSuccess: async () => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['role-permissions', selectedId] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu quyền thất bại')
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/roles', {
        method: 'POST',
        csrfToken,
        body: {
          code: newRole.code,
          name: newRole.name,
          level: Number(newRole.level),
          description: newRole.description
        }
      }),
    onSuccess: async () => {
      setNewRole({ code: '', name: '', level: 20, description: '' });
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Tạo role thất bại')
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/roles/${id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Xóa role thất bại')
  });

  const grouped = useMemo(() => {
    const rows = detail.data?.permissions ?? [];
    const map = new Map<string, PermissionRow[]>();
    for (const row of rows) {
      const list = map.get(row.module) ?? [];
      list.push(row);
      map.set(row.module, list);
    }
    return Array.from(map.entries());
  }, [detail.data]);

  function createRole(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Vai trò & quyền</h1>
          <p className="muted">Ma trận view/add/edit/delete + scope all/subtree/own.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {can('roles', 'add') && (
        <form className="panel form-grid" onSubmit={createRole}>
          <h2>Tạo role</h2>
          <label>
            Code
            <input
              value={newRole.code}
              onChange={(event) => setNewRole({ ...newRole, code: event.target.value })}
              placeholder="operator"
              required
            />
          </label>
          <label>
            Tên
            <input
              value={newRole.name}
              onChange={(event) => setNewRole({ ...newRole, name: event.target.value })}
              required
            />
          </label>
          <label>
            Level
            <input
              type="number"
              min={1}
              max={99}
              value={newRole.level}
              onChange={(event) => setNewRole({ ...newRole, level: Number(event.target.value) })}
            />
          </label>
          <label>
            Mô tả
            <input
              value={newRole.description}
              onChange={(event) => setNewRole({ ...newRole, description: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={create.isPending}>
              Tạo role
            </button>
          </div>
        </form>
      )}

      <div className="split">
        <aside className="panel role-list">
          <h2>Roles</h2>
          {roles.isLoading ? (
            <p className="state">Đang tải...</p>
          ) : (
            <ul>
              {roles.data?.items.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    className={`role-item ${role.id === selectedId ? 'active' : ''}`}
                    onClick={() => setSelectedId(role.id)}
                  >
                    <span>
                      <strong>{role.name}</strong>
                      <small className="mono">{role.code}</small>
                    </span>
                    <span className="badge">{role.level}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article className="panel">
          {!selected ? (
            <p className="state">Chọn một role.</p>
          ) : detail.isLoading ? (
            <p className="state">Đang tải quyền...</p>
          ) : (
            <>
              <div className="table-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted mono">{selected.code}</p>
                </div>
                <div className="row-actions">
                  {Number(selected.is_system) === 1 && <span className="badge">Hệ thống</span>}
                  {can('roles', 'delete') && Number(selected.is_system) === 0 && (
                    <button
                      className="btn small danger"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Xóa role ${selected.code}?`)) remove.mutate(selected.id);
                      }}
                    >
                      Xóa
                    </button>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Hành động</th>
                      <th>Mã quyền</th>
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(([module, rows]) =>
                      rows.map((row, index) => (
                        <tr key={row.code}>
                          <td>{index === 0 ? module : ''}</td>
                          <td>{row.action}</td>
                          <td className="mono muted">{row.code}</td>
                          <td>
                            <select
                              value={scopes[row.code] ?? 'none'}
                              disabled={Number(selected.is_system) === 1 || !can('roles', 'edit')}
                              onChange={(event) =>
                                setScopes({ ...scopes, [row.code]: event.target.value as Scope })
                              }
                            >
                              <option value="none">none</option>
                              <option value="own">own</option>
                              <option value="subtree">subtree</option>
                              <option value="all">all</option>
                            </select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {Number(selected.is_system) === 0 && can('roles', 'edit') && (
                <div className="form-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => save.mutate()}
                    disabled={save.isPending}
                  >
                    Lưu quyền
                  </button>
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
