import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Mountpoint, Station } from '../types';

interface StationList {
  items: Station[];
}

interface MountpointList {
  items: Mountpoint[];
  total: number;
}

const emptyForm = {
  name: '',
  station_id: '' as string | number,
  enabled: true,
  requires_auth: true
};

export function Mountpoints() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const stations = useQuery({
    queryKey: ['stations', 'options'],
    queryFn: () => apiFetch<StationList>('/api/stations?pageSize=100'),
    enabled: can('stations', 'view')
  });
  const list = useQuery({
    queryKey: ['mountpoints'],
    queryFn: () => apiFetch<MountpointList>('/api/mountpoints?pageSize=100')
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        station_id: form.station_id === '' ? null : Number(form.station_id),
        enabled: form.enabled,
        requires_auth: form.requires_auth
      };
      if (editingId) {
        return apiFetch(`/api/mountpoints/${editingId}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/mountpoints', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditingId(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['mountpoints'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/mountpoints/${id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['mountpoints'] }),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Xóa thất bại')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function edit(item: Mountpoint) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      station_id: item.station_id ?? '',
      enabled: Boolean(item.enabled),
      requires_auth: Boolean(item.requires_auth)
    });
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Mountpoint</h1>
          <p className="muted">Endpoint dữ liệu; có thể chưa gắn trạm.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {can('mountpoints', 'add') && (
        <form className="panel form-grid" onSubmit={submit}>
          <h2>{editingId ? 'Sửa mountpoint' : 'Thêm mountpoint'}</h2>
          <label>
            Tên mountpoint
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label>
            Trạm
            <select
              value={form.station_id}
              onChange={(event) => setForm({ ...form, station_id: event.target.value })}
            >
              <option value="">— Không gắn trạm —</option>
              {stations.data?.items.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.code} · {station.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.requires_auth}
              onChange={(event) => setForm({ ...form, requires_auth: event.target.checked })}
            />
            Yêu cầu xác thực
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
          <p className="state error">Không tải được mountpoint.</p>
        ) : list.data?.items.length === 0 ? (
          <p className="state">Chưa có mountpoint nào.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Trạm</th>
                <th>Bật</th>
                <th>Auth</th>
                <th>Owner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.name}</td>
                  <td>{item.station_code ? `${item.station_code} · ${item.station_name}` : '—'}</td>
                  <td>{item.enabled ? 'Có' : 'Không'}</td>
                  <td>{item.requires_auth ? 'Có' : 'Không'}</td>
                  <td className="muted">{item.owner_web_user_id ?? '—'}</td>
                  <td className="row-actions">
                    {can('mountpoints', 'edit') && (
                      <button className="btn small" type="button" onClick={() => edit(item)}>
                        Sửa
                      </button>
                    )}
                    {can('mountpoints', 'delete') && (
                      <button
                        className="btn small danger"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Xóa mountpoint ${item.name}?`)) remove.mutate(item.id);
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
