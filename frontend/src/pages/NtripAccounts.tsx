import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { NtripAccount } from '../types';

interface NtripAccountList {
  items: NtripAccount[];
  total: number;
}

const emptyForm = {
  username: '',
  password: '',
  enabled: true,
  max_connections: 1
};

export function NtripAccounts() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['ntrip-accounts'],
    queryFn: () => apiFetch<NtripAccountList>('/api/ntrip-accounts?pageSize=100')
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        username: form.username,
        enabled: form.enabled,
        max_connections: Number(form.max_connections)
      };
      if (form.password) body.password = form.password;
      if (editingId) {
        return apiFetch(`/api/ntrip-accounts/${editingId}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/ntrip-accounts', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditingId(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['ntrip-accounts'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'lock' | 'unlock' | 'delete' }) =>
      apiFetch(`/api/ntrip-accounts/${id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['ntrip-accounts'] }),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Thao tác thất bại')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function edit(item: NtripAccount) {
    setEditingId(item.id);
    setForm({
      username: item.username,
      password: '',
      enabled: item.enabled,
      max_connections: item.maxConnections
    });
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Tài khoản NTRIP</h1>
          <p className="muted">Tách biệt tài khoản web; dùng cho xác thực caster/rover.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {can('ntrip_accounts', 'add') && (
        <form className="panel form-grid" onSubmit={submit}>
          <h2>{editingId ? 'Sửa tài khoản NTRIP' : 'Thêm tài khoản NTRIP'}</h2>
          <label>
            Username
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </label>
          <label>
            Mật khẩu {editingId ? '(bỏ trống để giữ)' : ''}
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required={!editingId}
            />
          </label>
          <label>
            Max connections
            <input
              type="number"
              min={1}
              max={1000}
              value={form.max_connections}
              onChange={(event) =>
                setForm({ ...form, max_connections: Number(event.target.value) })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={save.isPending}>
              {editingId ? 'Cập nhật' : 'Thêm'}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                Hủy
              </button>
            )}
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-head">
          <h2>Danh sách</h2>
          <button className="btn ghost" onClick={() => list.refetch()} disabled={list.isFetching}>
            Tải lại
          </button>
        </div>
        {list.isLoading ? (
          <p className="state">Đang tải...</p>
        ) : list.isError ? (
          <p className="state error">Không tải được tài khoản NTRIP.</p>
        ) : list.data?.items.length === 0 ? (
          <p className="state">Chưa có tài khoản NTRIP nào.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Trạng thái</th>
                <th>Max conn</th>
                <th>Owner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.username}</td>
                  <td>
                    <span className={`badge ${item.enabled ? 'ok' : 'warn'}`}>
                      {item.enabled ? 'enabled' : 'locked'}
                    </span>
                  </td>
                  <td>{item.maxConnections}</td>
                  <td className="muted">{item.ownerWebUserId ?? '—'}</td>
                  <td className="row-actions">
                    {can('ntrip_accounts', 'edit') && (
                      <>
                        <button className="btn small" type="button" onClick={() => edit(item)}>
                          Sửa
                        </button>
                        <button
                          className="btn small"
                          type="button"
                          onClick={() =>
                            action.mutate({ id: item.id, action: item.enabled ? 'lock' : 'unlock' })
                          }
                        >
                          {item.enabled ? 'Khóa' : 'Mở khóa'}
                        </button>
                      </>
                    )}
                    {can('ntrip_accounts', 'delete') && (
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Xóa tài khoản NTRIP ${item.username}?`)) {
                            action.mutate({ id: item.id, action: 'delete' });
                          }
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
        <p className="muted">ACL mountpoint sẽ hoàn thiện ở Phase 4; API placeholder đã có.</p>
      </div>
    </section>
  );
}
