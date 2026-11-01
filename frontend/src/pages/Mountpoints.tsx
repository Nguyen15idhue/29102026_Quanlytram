import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { bulkMessage, sendBulk } from '../lib/bulk';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { Mountpoint, Station } from '../types';
import {
  BulkActionBar,
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
import { useToast } from '../components/ToastProvider';
import { MountpointExplorerDrawer } from './MountpointExplorer';

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
  service_type: 'rtcm',
  position_mode: 'normal',
  satellite_systems: '',
  caster_interval: 0,
  code_protocol: '',
  code_type: '',
  description: ''
};

export function Mountpoints() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const stationId = getParam('stationId');
  const enabled = getParam('enabled');
  const activeFilterCount = [stationId, enabled].filter(Boolean).length;
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Mountpoint | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<Mountpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Mountpoint | null>(null);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const stations = useQuery({
    queryKey: ['stations', 'options'],
    queryFn: () => apiFetch<StationList>('/api/stations?pageSize=50'),
    enabled: can('stations', 'view')
  });
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (stationId) params.set('stationId', stationId);
    if (enabled) params.set('enabled', enabled);
    return params.toString();
  }, [page, pageSize, q, stationId, enabled]);
  const list = useQuery({
    queryKey: ['mountpoints', listQuery],
    queryFn: () => apiFetch<MountpointList>(`/api/mountpoints?${listQuery}`)
  });
  const impact = useQuery({
    queryKey: ['mountpoint-impact', deleteTarget?.id],
    queryFn: () =>
      apiFetch<{
        listeners: Array<{ id: number; name: string }>;
        accounts: Array<{ id: number; username: string }>;
        relays: Array<{ id: number; name: string }>;
        online: number;
        casterAvailable: boolean;
      }>(`/api/mountpoints/${deleteTarget?.id}/impact`),
    enabled: Boolean(deleteTarget?.id)
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        station_id: form.station_id === '' ? null : Number(form.station_id),
        enabled: form.enabled,
        description: form.description
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

  const bulk = useMutation({
    mutationFn: (action: string) =>
      sendBulk('/api/mountpoints/bulk', action, [...selected], csrfToken),
    onSuccess: async (result, action) => {
      setSelected(new Set());
      setBulkDeleteOpen(false);
      setDetail(null);
      push(bulkMessage(result), result.forbidden || result.notFound ? 'error' : 'success');
      if (action === 'delete') push('Đã xóa các mountpoint đã chọn', 'success');
      await queryClient.invalidateQueries({ queryKey: ['mountpoints'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Thao tác hàng loạt thất bại', 'error')
  });

  useEffect(() => {
    setSelected(new Set());
  }, [page, pageSize, q, stationId, enabled]);

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
      service_type: item.service_type ?? 'rtcm',
      position_mode: item.position_mode ?? 'normal',
      satellite_systems: item.satellite_systems ?? '',
      caster_interval: item.caster_interval ?? 0,
      code_protocol: item.code_protocol ?? '',
      code_type: item.code_type ?? '',
      description: item.description ?? ''
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
        <TableToolbar
          search={
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Tìm mountpoint hoặc trạm"
            />
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Trạm">
            <Select
              value={stationId}
              onChange={(event) => setParam('stationId', event.target.value || null)}
            >
              <option value="">Mọi trạm</option>
              {(stations.data?.items ?? []).map((station) => (
                <option key={station.id} value={station.id}>
                  {station.code}
                </option>
              ))}
            </Select>
          </Field>
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
        <BulkActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          actions={[
            ...(can('mountpoints', 'edit')
              ? [
                  { label: 'Bật', onClick: () => bulk.mutate('enable') },
                  { label: 'Tắt', onClick: () => bulk.mutate('disable') }
                ]
              : []),
            ...(can('mountpoints', 'delete')
              ? [
                  {
                    label: 'Xóa',
                    variant: 'danger' as const,
                    onClick: () => setBulkDeleteOpen(true)
                  }
                ]
              : [])
          ]}
        />
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(item) => item.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          selectionLabel={(item) => `mountpoint ${item.name}`}
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
              header: 'Trạng thái',
              cell: (item) => (
                <StatusBadge
                  label={item.enabled ? 'enabled' : 'disabled'}
                  kind={item.enabled ? 'ok' : 'neutral'}
                />
              )
            },
            {
              key: 'note',
              header: 'Ghi chú',
              hideOnMobile: true,
              cell: (item) => <span className="muted">{item.description || '—'}</span>
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
          <Field label="Trạng thái">
            <Select
              value={form.enabled ? '1' : '0'}
              onChange={(event) => setForm({ ...form, enabled: event.target.value === '1' })}
            >
              <option value="1">Mở</option>
              <option value="0">Khóa</option>
            </Select>
          </Field>
          <Field label="Ghi chú">
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      {detail && (
        <MountpointExplorerDrawer id={detail.id} onClose={() => setDetail(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa mountpoint?"
        description={
          impact.data
            ? `Mountpoint ${deleteTarget?.name ?? ''} sẽ bị xóa. Liên kết: ${
                impact.data.listeners.length
              } listener, ${impact.data.relays.length} relay, ${
                impact.data.accounts.length
              } tài khoản, ${impact.data.online} online${
                impact.data.casterAvailable ? '' : ' (không gọi được caster)'
              }.`
            : `Mountpoint ${deleteTarget?.name ?? ''} sẽ bị xóa.`
        }
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Xóa các mountpoint đã chọn?"
        description={`${selected.size} mountpoint sẽ bị xóa. Hành động này không thể hoàn tác.`}
        pending={bulk.isPending}
        onConfirm={() => bulk.mutate('delete')}
      />
    </section>
  );
}
