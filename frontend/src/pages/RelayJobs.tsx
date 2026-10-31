import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Pencil, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { RelayJob } from '../types';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  TableToolbar
} from '../components/ui';
import { QualityPanel } from '../components/QualityPanel';
import { useToast } from '../components/ToastProvider';

interface RelayJobList {
  items: RelayJob[];
  total: number;
}

const emptyForm = {
  name: '',
  enabled: false,
  upstreamHost: '',
  upstreamPort: 1509,
  upstreamMount: '',
  downstreamHost: '',
  downstreamPort: 1509,
  downstreamMount: '',
  downstreamMode: 'auto'
};

function stateKind(state: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'streaming') return 'ok';
  if (state === 'error') return 'error';
  if (state === 'backoff' || state === 'connecting') return 'warn';
  return 'neutral';
}

export function RelayJobs() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const enabled = getParam('enabled');
  const activeFilterCount = [enabled].filter(Boolean).length;
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<RelayJob | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<RelayJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RelayJob | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (enabled) params.set('enabled', enabled);
    return params.toString();
  }, [page, pageSize, q, enabled]);
  const list = useQuery({
    queryKey: ['relay-jobs', listQuery],
    queryFn: () => apiFetch<RelayJobList>(`/api/relay-jobs?${listQuery}`)
  });

  useEffect(() => {
    const jobId = Number(searchParams.get('job'));
    if (!jobId) return;
    const found = list.data?.items.find((item) => item.id === jobId);
    if (found) setDetail(found);
  }, [list.data, searchParams]);

  function closeDetail() {
    setDetail(null);
    if (searchParams.has('job')) {
      const next = new URLSearchParams(searchParams);
      next.delete('job');
      setSearchParams(next, { replace: true });
    }
  }

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
      if (editing) {
        return apiFetch(`/api/relay-jobs/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/relay-jobs', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật relay job' : 'Đã thêm relay job', 'success');
      await queryClient.invalidateQueries({ queryKey: ['relay-jobs'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({
      job,
      action
    }: {
      job: RelayJob;
      action: 'enable' | 'disable' | 'restart' | 'test' | 'delete';
    }) =>
      apiFetch(`/api/relay-jobs/${job.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async (result, variables) => {
      if (variables.action === 'test') {
        const value = result as { result?: { ok?: boolean; error?: string } };
        push(value.result?.ok ? 'Test kết nối: OK' : `Test thất bại: ${value.result?.error ?? ''}`, value.result?.ok ? 'success' : 'error');
      } else {
        push('Đã cập nhật relay job', 'success');
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['relay-jobs'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Thao tác thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(job: RelayJob) {
    setEditing(job);
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
    setError('');
    setDirty(false);
    setFormOpen(true);
    setDetail(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="page">
      <PageHeader
        title="Relay"
        description="Cấu hình đã lưu và trạng thái Go đã áp dụng."
        actions={
          can('relay', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm relay job
            </Button>
          )
        }
      />

      <div className="panel">
        <TableToolbar
          search={
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Tìm relay job, host, mountpoint"
            />
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Trạng thái">
            <Select
              value={enabled}
              onChange={(event) => setParam('enabled', event.target.value || null)}
            >
              <option value="">Tất cả</option>
              <option value="1">Đang bật</option>
              <option value="0">Đã tắt</option>
            </Select>
          </Field>
        </TableToolbar>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(job) => job.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được relay job.' : undefined}
          empty="Chưa có relay job nào."
          onRowClick={setDetail}
          columns={[
            {
              key: 'name',
              header: 'Tên',
              cell: (job) => (
                <div>
                  <strong>{job.name}</strong>
                  <div className="muted">{job.enabled ? 'enabled' : 'disabled'}</div>
                </div>
              )
            },
            {
              key: 'upstream',
              header: 'Upstream',
              hideOnMobile: true,
              cell: (job) => (
                <div>
                  <div className="mono">
                    {job.upstream.host}:{job.upstream.port}/{job.upstream.mount}
                  </div>
                  <div className="muted table-subline">
                    {job.upstream.ntripVersion?.toUpperCase() ?? 'V1'} ·{' '}
                    {job.upstream.ssl ? 'TLS' : 'TCP'} ·{' '}
                    {job.upstream.credential?.username || 'no-auth'}
                  </div>
                </div>
              )
            },
            {
              key: 'downstream',
              header: 'Downstream',
              hideOnMobile: true,
              cell: (job) => (
                <div>
                  <div className="mono">
                    {job.downstream.host}:{job.downstream.port}/{job.downstream.mount}
                  </div>
                  <div className="muted table-subline">
                    {job.downstreamMode} · {job.downstream.ntripVersion?.toUpperCase() ?? 'V1'} ·{' '}
                    {job.downstream.ssl ? 'TLS' : 'TCP'} ·{' '}
                    {job.downstream.credential?.username || 'no-auth'}
                  </div>
                </div>
              )
            },
            {
              key: 'state',
              header: 'Trạng thái',
              cell: (job) => {
                const state = job.state?.runtimeState ?? 'pending';
                return (
                  <div>
                    <StatusBadge label={state} kind={stateKind(state)} />
                    {job.state?.lastError && (
                      <div className="muted table-subline">{job.state.lastError}</div>
                    )}
                  </div>
                );
              }
            },
            {
              key: 'revision',
              header: 'Applied / desired',
              align: 'right',
              hideOnMobile: true,
              cell: (job) => (
                <div>
                  <div className="mono">
                    {job.state?.appliedRevision ?? 0}/{job.desiredRevision}
                  </div>
                  <div className="muted table-subline">
                    {job.state?.lastAppliedAt
                      ? new Date(job.state.lastAppliedAt).toLocaleString('vi-VN')
                      : 'chưa áp dụng'}
                  </div>
                </div>
              )
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (job) => (
                <div className="row-actions">
                  {can('relay', 'edit') && (
                    <>
                      <IconButton
                        label={`Sửa ${job.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(job);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={job.enabled ? `Tắt ${job.name}` : `Bật ${job.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ job, action: job.enabled ? 'disable' : 'enable' });
                        }}
                      >
                        {job.enabled ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                      </IconButton>
                      <IconButton
                        label={`Restart ${job.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ job, action: 'restart' });
                        }}
                      >
                        <RotateCw size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Test ${job.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ job, action: 'test' });
                        }}
                      >
                        <FlaskConical size={16} aria-hidden="true" />
                      </IconButton>
                    </>
                  )}
                  {can('relay', 'delete') && (
                    <IconButton
                      label={`Xóa ${job.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(job);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              )
            }
          ]}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setDirty(false);
            setEditing(null);
          }
        }}
        title={editing ? 'Sửa relay job' : 'Thêm relay job'}
        description="Cấu hình bridge upstream → downstream."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="relay-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Thêm'}
            </Button>
          </>
        }
      >
        <form
          id="relay-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <Field label="Tên" error={error || undefined}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Downstream mode">
            <Select
              value={form.downstreamMode}
              onChange={(event) => setForm({ ...form, downstreamMode: event.target.value })}
            >
              <option value="auto">auto</option>
              <option value="post">post</option>
              <option value="source">source</option>
            </Select>
          </Field>
          <Field label="Upstream host">
            <Input
              value={form.upstreamHost}
              onChange={(event) => setForm({ ...form, upstreamHost: event.target.value })}
              required
            />
          </Field>
          <Field label="Upstream port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.upstreamPort}
              onChange={(event) => setForm({ ...form, upstreamPort: Number(event.target.value) })}
            />
          </Field>
          <Field label="Upstream mount">
            <Input
              value={form.upstreamMount}
              onChange={(event) => setForm({ ...form, upstreamMount: event.target.value })}
              required
            />
          </Field>
          <Field label="Downstream host">
            <Input
              value={form.downstreamHost}
              onChange={(event) => setForm({ ...form, downstreamHost: event.target.value })}
              required
            />
          </Field>
          <Field label="Downstream port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.downstreamPort}
              onChange={(event) => setForm({ ...form, downstreamPort: Number(event.target.value) })}
            />
          </Field>
          <Field label="Downstream mount">
            <Input
              value={form.downstreamMount}
              onChange={(event) => setForm({ ...form, downstreamMount: event.target.value })}
              required
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật relay job
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && closeDetail()}
        title={detail?.name ?? 'Chi tiết relay job'}
        description={detail ? `${detail.upstream.mount} → ${detail.downstream.mount}` : undefined}
        side="right"
        size="lg"
        footer={
          detail && (
            <>
              {can('relay', 'edit') && (
                <Button onClick={() => openEdit(detail)}>
                  <Pencil size={16} aria-hidden="true" /> Sửa
                </Button>
              )}
              <Button variant="ghost" onClick={closeDetail}>
                Đóng
              </Button>
            </>
          )
        }
      >
        {detail && (
          <>
            <dl className="facts">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge
                    label={detail.state?.runtimeState ?? 'pending'}
                    kind={stateKind(detail.state?.runtimeState ?? 'pending')}
                  />
                </dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd className="mono">
                  {detail.state?.appliedRevision ?? 0}/{detail.desiredRevision}
                </dd>
              </div>
              <div>
                <dt>Upstream</dt>
                <dd className="mono">
                  {detail.upstream.host}:{detail.upstream.port}/{detail.upstream.mount}
                </dd>
              </div>
              <div>
                <dt>Downstream</dt>
                <dd className="mono">
                  {detail.downstream.host}:{detail.downstream.port}/{detail.downstream.mount}
                </dd>
              </div>
            </dl>
            {detail.state?.lastError && <div className="alert error">{detail.state.lastError}</div>}
            {can('quality', 'view') && (
              <QualityPanel
                key={detail.id}
                targetType="relay_job"
                targetId={detail.id}
              />
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa relay job?"
        description={`Relay ${deleteTarget?.name ?? ''} sẽ dừng và bị xóa mềm; history được giữ.`}
        pending={action.isPending}
        onConfirm={() => deleteTarget && action.mutate({ job: deleteTarget, action: 'delete' })}
      />
    </section>
  );
}
