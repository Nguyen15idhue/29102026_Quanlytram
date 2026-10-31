import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Antenna, Pencil, Plus, Power, PowerOff, Trash2, Unplug } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useListParams } from '../lib/useListParams';
import type { CasterConnection, CasterListener, Mountpoint } from '../types';
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
  Tabs
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface ListenerList {
  items: CasterListener[];
  total: number;
}

interface ConnectionList {
  items: CasterConnection[];
  total: number;
}

interface MountpointList {
  items: Mountpoint[];
}

const emptyForm = {
  name: '',
  port: 1509,
  enabled: true,
  role: 'both',
  description: ''
};

function ListenerPanel() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CasterListener | null>(null);
  const [detail, setDetail] = useState<CasterListener | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CasterListener | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [mountpointIds, setMountpointIds] = useState<number[]>([]);

  const list = useQuery({
    queryKey: ['caster-listeners', page, pageSize, q],
    queryFn: () =>
      apiFetch<ListenerList>(
        `/api/caster/listeners?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });
  const mountpoints = useQuery({
    queryKey: ['mountpoints', 'caster-options'],
    queryFn: () => apiFetch<MountpointList>('/api/mountpoints?pageSize=50'),
    enabled: Boolean(detail) && can('mountpoints', 'view')
  });
  const mapping = useQuery({
    queryKey: ['caster-listener-mountpoints', detail?.id],
    queryFn: () => apiFetch<MountpointList>(`/api/caster/listeners/${detail?.id}/mountpoints`),
    enabled: Boolean(detail)
  });

  useEffect(() => {
    if (mapping.data) setMountpointIds(mapping.data.items.map((item) => item.id));
  }, [mapping.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        port: Number(form.port),
        enabled: form.enabled,
        role: form.role,
        description: form.description
      };
      if (editing) {
        return apiFetch(`/api/caster/listeners/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/caster/listeners', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật listener' : 'Đã thêm listener', 'success');
      await queryClient.invalidateQueries({ queryKey: ['caster-listeners'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({ listener, action }: { listener: CasterListener; action: 'enable' | 'disable' | 'delete' }) =>
      apiFetch(`/api/caster/listeners/${listener.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetail(null);
      push('Đã cập nhật listener', 'success');
      await queryClient.invalidateQueries({ queryKey: ['caster-listeners'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Thao tác thất bại', 'error')
  });

  const saveMapping = useMutation({
    mutationFn: () =>
      apiFetch(`/api/caster/listeners/${detail?.id}/mountpoints`, {
        method: 'PUT',
        body: { mountpointIds },
        csrfToken
      }),
    onSuccess: async () => {
      push('Đã lưu mountpoint cho listener', 'success');
      await queryClient.invalidateQueries({ queryKey: ['caster-listener-mountpoints', detail?.id] });
      await queryClient.invalidateQueries({ queryKey: ['caster-listeners'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Lưu mountpoint thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setFormOpen(true);
  }

  function openEdit(listener: CasterListener) {
    setEditing(listener);
    setForm({
      name: listener.name,
      port: listener.port,
      enabled: listener.enabled,
      role: listener.role,
      description: listener.description
    });
    setError('');
    setFormOpen(true);
    setDetail(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <>
      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm listener" />
          <div className="toolbar">
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
            {can('caster', 'add') && (
              <Button variant="primary" onClick={openCreate}>
                <Plus size={16} aria-hidden="true" /> Thêm listener
              </Button>
            )}
          </div>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(listener) => listener.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được listener.' : undefined}
          empty="Chưa có listener nào."
          onRowClick={setDetail}
          columns={[
            {
              key: 'name',
              header: 'Listener',
              cell: (listener) => (
                <div>
                  <strong>{listener.name}</strong>
                  <div className="muted mono">:{listener.port}</div>
                </div>
              )
            },
            {
              key: 'role',
              header: 'Vai trò',
              hideOnMobile: true,
              cell: (listener) => <StatusBadge label={listener.role} />
            },
            {
              key: 'mountpoints',
              header: 'Mountpoint',
              align: 'right',
              cell: (listener) => listener.mountpointCount
            },
            {
              key: 'enabled',
              header: 'Trạng thái',
              cell: (listener) => (
                <StatusBadge
                  label={listener.enabled ? 'enabled' : 'disabled'}
                  kind={listener.enabled ? 'ok' : 'neutral'}
                />
              )
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (listener) => (
                <div className="row-actions">
                  {can('caster', 'edit') && (
                    <>
                      <IconButton
                        label={`Sửa ${listener.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(listener);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={listener.enabled ? `Tắt ${listener.name}` : `Bật ${listener.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({ listener, action: listener.enabled ? 'disable' : 'enable' });
                        }}
                      >
                        {listener.enabled ? <PowerOff size={16} aria-hidden="true" /> : <Power size={16} aria-hidden="true" />}
                      </IconButton>
                    </>
                  )}
                  {can('caster', 'delete') && (
                    <IconButton
                      label={`Xóa ${listener.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(listener);
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
          if (!open) setEditing(null);
        }}
        title={editing ? 'Sửa listener' : 'Thêm listener'}
        description="Listener NTRIP cho source và rover; mặc định 1509."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="caster-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Thêm'}
            </Button>
          </>
        }
      >
        <form id="caster-form" className="form-grid" onSubmit={submit}>
          <Field label="Tên" error={error || undefined}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
              required
            />
          </Field>
          <Field label="Vai trò">
            <Select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              <option value="both">both</option>
              <option value="source">source</option>
              <option value="rover">rover</option>
            </Select>
          </Field>
          <Field label="Mô tả">
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật listener
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? 'Chi tiết listener'}
        description={detail ? `Port ${detail.port} · ${detail.role}` : undefined}
        side="right"
        footer={
          detail && (
            <>
              {can('caster', 'edit') && (
                <Button onClick={() => openEdit(detail)}>
                  <Pencil size={16} aria-hidden="true" /> Sửa
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDetail(null)}>
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
                <dt>Port</dt>
                <dd className="mono">{detail.port}</dd>
              </div>
              <div>
                <dt>Vai trò</dt>
                <dd>{detail.role}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>{detail.enabled ? 'enabled' : 'disabled'}</dd>
              </div>
              <div>
                <dt>Mountpoint</dt>
                <dd>{detail.mountpointCount}</dd>
              </div>
            </dl>
            <div className="panel">
              <div className="table-head">
                <h2>Mountpoint trên listener</h2>
                {can('caster', 'edit') && (
                  <Button size="sm" onClick={() => saveMapping.mutate()} loading={saveMapping.isPending}>
                    Lưu mountpoint
                  </Button>
                )}
              </div>
              {mountpoints.data?.items.length ? (
                <div className="check-list">
                  {mountpoints.data.items.map((mountpoint) => (
                    <label className="check" key={mountpoint.id}>
                      <input
                        type="checkbox"
                        checked={mountpointIds.includes(mountpoint.id)}
                        disabled={!can('caster', 'edit')}
                        onChange={(event) =>
                          setMountpointIds((current) =>
                            event.target.checked
                              ? [...current, mountpoint.id]
                              : current.filter((id) => id !== mountpoint.id)
                          )
                        }
                      />
                      <span className="mono">{mountpoint.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">Chưa có mountpoint hoặc chưa có quyền xem.</p>
              )}
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa listener?"
        description={`Listener ${deleteTarget?.name ?? ''} sẽ dừng và bị xóa.`}
        pending={action.isPending}
        onConfirm={() => deleteTarget && action.mutate({ listener: deleteTarget, action: 'delete' })}
      />
    </>
  );
}

function ConnectionsPanel() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [disconnectTarget, setDisconnectTarget] = useState<CasterConnection | null>(null);

  const list = useQuery({
    queryKey: ['caster-connections', page, pageSize, q],
    queryFn: () =>
      apiFetch<ConnectionList>(
        `/api/caster/connections?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });

  const disconnect = useMutation({
    mutationFn: (connection: CasterConnection) =>
      apiFetch(`/api/caster/connections/${connection.id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      setDisconnectTarget(null);
      push('Đã ngắt kết nối', 'success');
      await queryClient.invalidateQueries({ queryKey: ['caster-connections'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Ngắt kết nối thất bại', 'error')
  });

  return (
    <div className="panel">
      <div className="table-head">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm kết nối" />
        <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
          Tải lại
        </Button>
      </div>
      <DataTable
        items={list.data?.items ?? []}
        rowKey={(connection) => connection.id}
        loading={list.isLoading}
        error={list.isError ? 'Không tải được kết nối.' : undefined}
        empty="Không có kết nối đang mở."
        columns={[
          {
            key: 'direction',
            header: 'Hướng',
            cell: (connection) => (
              <StatusBadge
                label={connection.direction}
                kind={connection.direction === 'source' ? 'info' : 'ok'}
              />
            )
          },
          {
            key: 'mountpoint',
            header: 'Mountpoint',
            cell: (connection) => <span className="mono">{connection.mountpointName}</span>
          },
          {
            key: 'listener',
            header: 'Listener',
            hideOnMobile: true,
            cell: (connection) => `${connection.listenerName}:${connection.listenerId}`
          },
          {
            key: 'account',
            header: 'Tài khoản',
            hideOnMobile: true,
            cell: (connection) => connection.accountUsername || '—'
          },
          {
            key: 'remote',
            header: 'Remote',
            hideOnMobile: true,
            cell: (connection) => (
              <div>
                <div className="mono">{connection.remoteAddr}</div>
                {connection.userAgent && (
                  <div className="muted table-subline">{connection.userAgent}</div>
                )}
              </div>
            )
          },
          {
            key: 'start',
            header: 'Bắt đầu / thời lượng',
            hideOnMobile: true,
            cell: (connection) => {
              const seconds = Math.max(
                0,
                Math.floor((Date.now() - new Date(connection.startTs).getTime()) / 1000)
              );
              return (
                <div>
                  <div className="mono">
                    {new Date(connection.startTs).toLocaleString('vi-VN')}
                  </div>
                  <div className="muted table-subline">
                    {Math.floor(seconds / 3600)}h{' '}
                    {Math.floor((seconds % 3600) / 60)}m
                  </div>
                </div>
              );
            }
          },
          {
            key: 'bytes',
            header: 'Byte',
            align: 'right',
            cell: (connection) => (
              <span className="mono">
                {connection.bytesIn}/{connection.bytesOut}
              </span>
            )
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (connection) =>
              can('connections', 'delete') && (
                <IconButton
                  label={`Ngắt kết nối ${connection.id}`}
                  onClick={() => setDisconnectTarget(connection)}
                >
                  <Unplug size={16} aria-hidden="true" />
                </IconButton>
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
      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title="Ngắt kết nối?"
        description={`Kết nối ${disconnectTarget?.remoteAddr ?? ''} sẽ bị đóng.`}
        confirmLabel="Ngắt"
        pending={disconnect.isPending}
        onConfirm={() => disconnectTarget && disconnect.mutate(disconnectTarget)}
      />
    </div>
  );
}

export function Caster() {
  const [tab, setTab] = useState<'listeners' | 'connections'>('listeners');
  return (
    <section className="page">
      <PageHeader
        title="Caster"
        description="Listener NTRIP, nhóm mountpoint và kết nối đang mở."
        actions={<Antenna size={20} className="muted" aria-hidden="true" />}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'listeners', label: 'Listener' },
          { value: 'connections', label: 'Kết nối' }
        ]}
      />
      {tab === 'listeners' ? <ListenerPanel /> : <ConnectionsPanel />}
    </section>
  );
}
