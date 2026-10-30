import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Station } from '../types';

interface StationList {
  items: Station[];
  total: number;
}

const emptyForm = { code: '', name: '', host: '', port: 2101 };

export function Stations() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['stations'],
    queryFn: () => apiFetch<StationList>('/api/stations?pageSize=100')
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code,
        name: form.name,
        host: form.host,
        port: Number(form.port)
      };
      if (editingId) {
        return apiFetch(`/api/stations/${editingId}`, {
          method: 'PATCH',
          body,
          csrfToken
        });
      }
      return apiFetch('/api/stations', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditingId(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/stations/${id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Xóa thất bại')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function edit(station: Station) {
    setEditingId(station.id);
    setForm({
      code: station.code,
      name: station.name,
      host: station.host,
      port: station.port
    });
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Trạm</h1>
          <p className="muted">CRUD trạm test; chưa gắn relay.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {can('stations', 'add') && (
        <form className="panel form-grid" onSubmit={submit}>
          <h2>{editingId ? 'Sửa trạm' : 'Thêm trạm'}</h2>
          <label>
            Mã trạm
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              required
            />
          </label>
          <label>
            Tên trạm
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label>
            Host
            <input
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
            />
          </label>
          <label>
            Port
            <input
              type="number"
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
              min={1}
              max={65535}
            />
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
          <p className="state error">Không tải được danh sách trạm.</p>
        ) : list.data?.items.length === 0 ? (
          <p className="state">Chưa có trạm nào.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên</th>
                <th>Host:Port</th>
                <th>Owner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((station) => (
                <tr key={station.id}>
                  <td className="mono">{station.code}</td>
                  <td>{station.name}</td>
                  <td className="mono">
                    {station.host}:{station.port}
                  </td>
                  <td className="muted">{station.owner_web_user_id ?? '—'}</td>
                  <td className="row-actions">
                    {can('stations', 'edit') && (
                      <button className="btn small" onClick={() => edit(station)} type="button">
                        Sửa
                      </button>
                    )}
                    {can('stations', 'delete') && (
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Xóa trạm ${station.code}?`)) remove.mutate(station.id);
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
