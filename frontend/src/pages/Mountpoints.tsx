import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { Mountpoint, Station } from '../types';
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
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

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
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Mountpoint | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<Mountpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Mountpoint | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const stations = useQuery({
    queryKey: ['stations', 'options'],
    queryFn: () => apiFetch<StationList>('/api/stations?pageSize=50'),
    enabled: can('stations', 'view')
  });
  const list = useQuery({
    queryKey: ['mountpoints', page, pageSize, q],
    queryFn: () =>
      apiFetch<MountpointList>(
        `/api/mountpoints?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        station_id: form.station_id === '' ? null : Number(form.station_id),
        enabled: form.enabled,
        requires_auth: form.requires_auth
      };
      if (editing) {
        return apiFetch(`/api/mountpoints/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/mountpoints', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật mountpoint' : 'Đã thêm mountpoint', 'success');
      await queryClient.invalidateQueries({ queryKey: ['mountpoints'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const remove = useMutation({
    mutationFn: (item: Mountpoint) =>
      apiFetch(`/api/mountpoints/${item.id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetail(null);
      push('Đã xóa mountpoint', 'success');
      await queryClient.invalidateQueries({ queryKey: ['mountpoints'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Xóa thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(item: Mountpoint) {
    setEditing(item);
    setForm({
      name: item.name,
      station_id: item.station_id ?? '',
      enabled: Boolean(item.enabled),
      requires_auth: Boolean(item.requires_auth)
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
        title="Mountpoint"
        description="Endpoint dữ liệu; một trạm có thể có nhiều mountpoint."
        actions={
          can('mountpoints', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm mountpoint
            </Button>
          )
        }
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mountpoint" />
          <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
            Tải lại
          </Button>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(item) => item.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được mountpoint.' : undefined}
          empty="Chưa có mountpoint nào."
          onRowClick={setDetail}
          columns={[
            {
              key: 'name',
              header: 'Tên',
              cell: (item) => <span className="mono">{item.name}</span>
            },
            {
              key: 'station',
              header: 'Trạm',
              cell: (item) =>
                item.station_code ? `${item.station_code} · ${item.station_name}` : '—'
            },
            {
              key: 'enabled',
              header: 'Bật',
              cell: (item) => (
                <StatusBadge
                  label={item.enabled ? 'enabled' : 'disabled'}
                  kind={item.enabled ? 'ok' : 'neutral'}
                />
              )
            },
            {
              key: 'auth',
              header: 'Auth',
              hideOnMobile: true,
              cell: (item) => (item.requires_auth ? 'Có' : 'Không')
            },
            {
              key: 'owner',
              header: 'Owner',
              hideOnMobile: true,
              cell: (item) => <span className="muted">{item.owner_web_user_id ?? '—'}</span>
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (item) => (
                <div className="row-actions">
                  {can('mountpoints', 'edit') && (
                    <IconButton
                      label={`Sửa ${item.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(item);
                      }}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                  )}
                  {can('mountpoints', 'delete') && (
                    <IconButton
                      label={`Xóa ${item.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(item);
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
        title={editing ? 'Sửa mountpoint' : 'Thêm mountpoint'}
        description="Endpoint dữ liệu; có thể chưa gắn trạm."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="mountpoint-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Thêm'}
            </Button>
          </>
        }
      >
        <form
          id="mountpoint-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <Field label="Tên mountpoint" error={error || undefined}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Trạm">
            <Select
              value={form.station_id}
              onChange={(event) => setForm({ ...form, station_id: event.target.value })}
            >
              <option value="">— Không gắn trạm —</option>
              {stations.data?.items.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.code} · {station.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật mountpoint
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.requires_auth}
              onChange={(event) => setForm({ ...form, requires_auth: event.target.checked })}
            />
            Yêu cầu xác thực
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? 'Chi tiết mountpoint'}
        description={detail?.station_code ? `Trạm ${detail.station_code}` : 'Chưa gắn trạm'}
        side="right"
        footer={
          detail && (
            <>
              {can('mountpoints', 'edit') && (
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
          <dl className="facts">
            <div>
              <dt>Trạng thái</dt>
              <dd>{detail.enabled ? 'enabled' : 'disabled'}</dd>
            </div>
            <div>
              <dt>Xác thực</dt>
              <dd>{detail.requires_auth ? 'Có' : 'Không'}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{detail.owner_web_user_id ?? '—'}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa mountpoint?"
        description={`Mountpoint ${deleteTarget?.name ?? ''} sẽ bị xóa.`}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </section>
  );
}
