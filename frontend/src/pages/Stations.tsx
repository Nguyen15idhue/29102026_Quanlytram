import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useListParams } from '../lib/useListParams';
import type { Station } from '../types';
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
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface StationList {
  items: Station[];
  total: number;
}

const emptyForm = {
  code: '',
  name: '',
  host: '',
  port: 2101,
  connection_type: 'ntrip',
  lat: '',
  lon: '',
  notes: ''
};

export function Stations() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [detail, setDetail] = useState<Station | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['stations', page, pageSize, q],
    queryFn: () =>
      apiFetch<StationList>(
        `/api/stations?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code,
        name: form.name,
        host: form.host,
        port: Number(form.port),
        connection_type: form.connection_type,
        lat: form.lat === '' ? null : Number(form.lat),
        lon: form.lon === '' ? null : Number(form.lon),
        notes: form.notes
      };
      if (editing) {
        return apiFetch(`/api/stations/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/stations', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật trạm' : 'Đã thêm trạm', 'success');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const remove = useMutation({
    mutationFn: (station: Station) =>
      apiFetch(`/api/stations/${station.id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetail(null);
      push('Đã xóa trạm', 'success');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Xóa thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setFormOpen(true);
  }

  function openEdit(station: Station) {
    setEditing(station);
    setForm({
      code: station.code,
      name: station.name,
      host: station.host,
      port: station.port,
      connection_type: station.connection_type,
      lat: station.lat === null ? '' : String(station.lat),
      lon: station.lon === null ? '' : String(station.lon),
      notes: station.notes
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
    <section className="page">
      <PageHeader
        title="Trạm"
        description="Trạm vật lý và cấu hình kết nối nguồn."
        actions={
          can('stations', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm trạm
            </Button>
          )
        }
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mã hoặc tên trạm" />
          <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
            Tải lại
          </Button>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(station) => station.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được danh sách trạm.' : undefined}
          empty="Chưa có trạm nào."
          onRowClick={setDetail}
          columns={[
            {
              key: 'code',
              header: 'Mã',
              cell: (station) => <span className="mono">{station.code}</span>
            },
            { key: 'name', header: 'Tên', cell: (station) => station.name },
            {
              key: 'host',
              header: 'Host:Port',
              hideOnMobile: true,
              cell: (station) => (
                <span className="mono">
                  {station.host}:{station.port}
                </span>
              )
            },
            {
              key: 'type',
              header: 'Kiểu',
              hideOnMobile: true,
              cell: (station) => <StatusBadge label={station.connection_type} />
            },
            {
              key: 'owner',
              header: 'Owner',
              hideOnMobile: true,
              cell: (station) => <span className="muted">{station.owner_web_user_id ?? '—'}</span>
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (station) => (
                <div className="row-actions">
                  {can('stations', 'edit') && (
                    <IconButton
                      label={`Sửa ${station.code}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(station);
                      }}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                  )}
                  {can('stations', 'delete') && (
                    <IconButton
                      label={`Xóa ${station.code}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(station);
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
        title={editing ? 'Sửa trạm' : 'Thêm trạm'}
        description="Thông tin trạm vật lý; không gắn trực tiếp vào relay."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="station-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Thêm'}
            </Button>
          </>
        }
      >
        <form id="station-form" className="form-grid" onSubmit={submit}>
          <Field label="Mã trạm" error={error || undefined}>
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              required
            />
          </Field>
          <Field label="Tên trạm">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Host">
            <Input
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
            />
          </Field>
          <Field label="Port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
            />
          </Field>
          <Field label="Kiểu kết nối">
            <Input
              value={form.connection_type}
              onChange={(event) => setForm({ ...form, connection_type: event.target.value })}
            />
          </Field>
          <Field label="Vĩ độ">
            <Input
              type="number"
              step="0.0000001"
              value={form.lat}
              onChange={(event) => setForm({ ...form, lat: event.target.value })}
            />
          </Field>
          <Field label="Kinh độ">
            <Input
              type="number"
              step="0.0000001"
              value={form.lon}
              onChange={(event) => setForm({ ...form, lon: event.target.value })}
            />
          </Field>
          <Field label="Ghi chú">
            <Input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? 'Chi tiết trạm'}
        description={detail?.code}
        side="right"
        footer={
          detail && (
            <>
              {can('stations', 'edit') && (
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
              <dt>Host</dt>
              <dd className="mono">
                {detail.host}:{detail.port}
              </dd>
            </div>
            <div>
              <dt>Kiểu</dt>
              <dd>{detail.connection_type}</dd>
            </div>
            <div>
              <dt>Vị trí</dt>
              <dd>
                {detail.lat ?? '—'}, {detail.lon ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{detail.owner_web_user_id ?? '—'}</dd>
            </div>
            <div>
              <dt>Ghi chú</dt>
              <dd>{detail.notes || '—'}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa trạm?"
        description={`Trạm ${deleteTarget?.code ?? ''} sẽ bị xóa. Hành động này không thể hoàn tác.`}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </section>
  );
}
