import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { RelayJob } from '../types';

interface RelayJobList {
  items: RelayJob[];
  total: number;
}

const emptyForm = {
  name: '',
  enabled: false,
  upstreamHost: '',
  upstreamPort: 2101,
  upstreamMount: '',
  downstreamHost: '',
  downstreamPort: 2101,
  downstreamMount: '',
  downstreamMode: 'auto'
};

function stateClass(state: string): string {
  if (state === 'streaming') return 'ok';
  if (state === 'error' || state === 'backoff') return 'warn';
  return '';
}

export function RelayJobs() {
  const { can, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const list = useQuery({
    queryKey: ['relay-jobs'],
    queryFn: () => apiFetch<RelayJobList>('/api/relay-jobs?pageSize=100')
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        enabled: form.enabled,
        downstreamMode: form.downstreamMode,
        upstream: {
          host: form.upstreamHost,
          port: Number(form.upstreamPort),
          mount: form.upstreamMount
        },
        downstream: {
          host: form.downstreamHost,
          port: Number(form.downstreamPort),
          mount: form.downstreamMount
        }
      };
      if (editingId) {
        return apiFetch(`/api/relay-jobs/${editingId}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/relay-jobs', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditingId(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['relay-jobs'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'enable' | 'disable' | 'restart' | 'test' | 'delete' }) =>
      apiFetch(`/api/relay-jobs/${id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async (result, variables) => {
      setError('');
      if (variables.action === 'test') {
        const value = result as { result?: { ok?: boolean; error?: string } };
        setNotice(value.result?.ok ? 'Test kết nối: OK' : `Test thất bại: ${value.result?.error ?? ''}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['relay-jobs'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Thao tác thất bại')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function edit(job: RelayJob) {
    setEditingId(job.id);
    setForm({
      name: job.name,
      enabled: job.enabled,
      upstreamHost: job.upstream.host,
      upstreamPort: job.upstream.port,
      upstreamMount: job.upstream.mount,
      downstreamHost: job.downstream.host,
      downstreamPort: job.downstream.port,
      downstreamMount: job.downstream.mount,
      downstreamMode: job.downstreamMode
    });
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Relay</h1>
          <p className="muted">Cấu hình đã lưu và trạng thái Go đã áp dụng.</p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      {can('relay', 'add') && (
        <form className="panel form-grid" onSubmit={submit}>
          <h2>{editingId ? 'Sửa relay job' : 'Thêm relay job'}</h2>
          <label>
            Tên
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label>
            Downstream mode
            <select
              value={form.downstreamMode}
              onChange={(event) => setForm({ ...form, downstreamMode: event.target.value })}
            >
              <option value="auto">auto</option>
              <option value="post">post</option>
              <option value="source">source</option>
            </select>
          </label>
          <label>
            Upstream host
            <input
              value={form.upstreamHost}
              onChange={(event) => setForm({ ...form, upstreamHost: event.target.value })}
              required
            />
          </label>
          <label>
            Upstream port
            <input
              type="number"
              min={1}
              max={65535}
              value={form.upstreamPort}
              onChange={(event) => setForm({ ...form, upstreamPort: Number(event.target.value) })}
            />
          </label>
          <label>
            Upstream mount
            <input
              value={form.upstreamMount}
              onChange={(event) => setForm({ ...form, upstreamMount: event.target.value })}
              required
            />
          </label>
          <label>
            Downstream host
            <input
              value={form.downstreamHost}
              onChange={(event) => setForm({ ...form, downstreamHost: event.target.value })}
              required
            />
          </label>
          <label>
            Downstream port
            <input
              type="number"
              min={1}
              max={65535}
              value={form.downstreamPort}
              onChange={(event) => setForm({ ...form, downstreamPort: Number(event.target.value) })}
            />
          </label>
          <label>
            Downstream mount
            <input
              value={form.downstreamMount}
              onChange={(event) => setForm({ ...form, downstreamMount: event.target.value })}
              required
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
          <p className="state error">Không tải được relay job.</p>
        ) : list.data?.items.length === 0 ? (
          <p className="state">Chưa có relay job nào.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Upstream</th>
                <th>Downstream</th>
                <th>Trạng thái</th>
                <th>Revision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((job) => {
                const state = job.state?.runtimeState ?? 'pending';
                return (
                  <tr key={job.id}>
                    <td>
                      {job.name}
                      <div className="muted mono">{job.enabled ? 'enabled' : 'disabled'}</div>
                    </td>
                    <td className="mono">
                      {job.upstream.host}:{job.upstream.port}/{job.upstream.mount}
                    </td>
                    <td className="mono">
                      {job.downstream.host}:{job.downstream.port}/{job.downstream.mount}
                    </td>
                    <td>
                      <span className={`badge ${stateClass(state)}`}>{state}</span>
                      {job.state?.lastError && <div className="muted">{job.state.lastError}</div>}
                    </td>
                    <td className="mono">
                      {job.state?.appliedRevision ?? 0}/{job.desiredRevision}
                    </td>
                    <td className="row-actions">
                      {can('relay', 'edit') && (
                        <>
                          <button className="btn small" type="button" onClick={() => edit(job)}>
                            Sửa
                          </button>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() =>
                              action.mutate({ id: job.id, action: job.enabled ? 'disable' : 'enable' })
                            }
                          >
                            {job.enabled ? 'Tắt' : 'Bật'}
                          </button>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() => action.mutate({ id: job.id, action: 'restart' })}
                          >
                            Restart
                          </button>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() => action.mutate({ id: job.id, action: 'test' })}
                          >
                            Test
                          </button>
                        </>
                      )}
                      {can('relay', 'delete') && (
                        <button
                          className="btn small danger"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Xóa relay job ${job.name}?`)) {
                              action.mutate({ id: job.id, action: 'delete' });
                            }
                          }}
                        >
                          Xóa
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
