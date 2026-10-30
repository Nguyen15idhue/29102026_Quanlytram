import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Role, WebUser } from '../types';

interface UserList {
  items: WebUser[];
  total: number;
}

interface RoleList {
  items: Role[];
}

export function WebUsers() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    username: '',
    password: '',
    display_name: '',
    email: '',
    role_id: ''
  });

  const users = useQuery({
    queryKey: ['web-users'],
    queryFn: () => apiFetch<UserList>('/api/web-users?pageSize=100')
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleList>('/api/roles')
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/web-users', {
        method: 'POST',
        csrfToken,
        body: {
          username: form.username,
          password: form.password,
          display_name: form.display_name,
          email: form.email,
          role_id: Number(form.role_id)
        }
      }),
    onSuccess: async () => {
      setForm({ username: '', password: '', display_name: '', email: '', role_id: '' });
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Tạo thất bại')
  });

  const action = useMutation({
    mutationFn: ({ id, path }: { id: number; path: string }) =>
      apiFetch(`/api/web-users/${id}/${path}`, { method: 'POST', csrfToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Thao tác thất bại')
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/web-users/${id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Xóa thất bại')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Người dùng web</h1>
          <p className="muted">Tài khoản đăng nhập UI, tách biệt với tài khoản NTRIP.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {can('web_users', 'add') && (
        <form className="panel form-grid" onSubmit={submit}>
          <h2>Thêm tài khoản</h2>
          <label>
            Username
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required
            />
          </label>
          <label>
            Tên hiển thị
            <input
              value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            Vai trò
            <select
              value={form.role_id}
              onChange={(event) => setForm({ ...form, role_id: event.target.value })}
              required
            >
              <option value="">Chọn role</option>
              {roles.data?.items.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.code})
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={create.isPending}>
              Tạo
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-head">
          <h2>Danh sách</h2>
          <button className="btn ghost" onClick={() => users.refetch()} disabled={users.isFetching}>
            Tải lại
          </button>
        </div>
        {users.isLoading ? (
          <p className="state">Đang tải...</p>
        ) : users.isError ? (
          <p className="state error">Không tải được danh sách.</p>
        ) : users.data?.items.length === 0 ? (
          <p className="state">Chưa có tài khoản.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Tên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((user) => (
                <tr key={user.id}>
                  <td className="mono">{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>
                    {user.role.name} <span className="muted">({user.role.code})</span>
                  </td>
                  <td>
                    <span className={`badge ${user.status === 'active' ? 'ok' : 'warn'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    {can('web_users', 'edit') && user.status === 'active' && (
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => action.mutate({ id: user.id, path: 'lock' })}
                      >
                        Khóa
                      </button>
                    )}
                    {can('web_users', 'edit') && user.status !== 'active' && (
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => action.mutate({ id: user.id, path: 'unlock' })}
                      >
                        Mở khóa
                      </button>
                    )}
                    {can('web_users', 'delete') && (
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Xóa tài khoản ${user.username}?`)) remove.mutate(user.id);
                        }}
                      >
                        Xóa
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
