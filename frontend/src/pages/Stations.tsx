import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
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
  Select,
  StatusBadge
} from '../components/ui';
import { QualityPanel } from '../components/QualityPanel';
import { useToast } from '../components/ToastProvider';

interface StationList {
  items: Station[];
  total: number;
}

interface DictionaryItem {
  code: string;
  key: string;
  value: string;
}

const emptyForm = {
  code: '', name: '', host: '', port: 1509, connection_type: 'ntrip',
  lat: '', lon: '', notes: '', station_type: 'reference', enabled: true,
  receiver_type: '', receiver_sn: '', receiver_firmware: '',
  antenna_type: '', antenna_sn: '', antenna_height: '', elevation_mask: '',
  contractor: '', region: '', address: '', device_id: '',
  network_type: '', network_mode: '', protocol: 'ntrip'
};

function formFromStation(station: Station) {
  return {
    ...emptyForm,
    code: station.code,
    name: station.name,
    host: station.host,
    port: station.port,
    connection_type: station.connection_type,
    lat: station.lat === null ? '' : String(station.lat),
    lon: station.lon === null ? '' : String(station.lon),
    notes: station.notes,
    station_type: station.station_type ?? 'reference',
    enabled: Boolean(station.enabled ?? true),
    receiver_type: station.receiver_type ?? '',
    receiver_sn: station.receiver_sn ?? '',
    receiver_firmware: station.receiver_firmware ?? '',
    antenna_type: station.antenna_type ?? '',
    antenna_sn: station.antenna_sn ?? '',
    antenna_height: station.antenna_height == null ? '' : String(station.antenna_height),
    elevation_mask: station.elevation_mask == null ? '' : String(station.elevation_mask),
    contractor: station.contractor ?? '',
    region: station.region ?? '',
    address: station.address ?? '',
    device_id: station.device_id ?? '',
    network_type: station.network_type ?? '',
    network_mode: station.network_mode ?? '',
    protocol: station.protocol ?? 'ntrip'
  };
}

function stateKind(state?: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (state === 'streaming') return 'ok';
  if (state === 'stale') return 'warn';
  if (state === 'error') return 'error';
  return 'neutral';
}

export function Stations() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<Station | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState('');
  const [importPreview, setImportPreview] = useState<{
    items: Record<string, unknown>[];
    errors: string[];
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ['stations', page, pageSize, q],
    queryFn: () =>
      apiFetch<StationList>(
        `/api/stations?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });

  const dictionaries = useQuery({
    queryKey: ['dictionaries'],
    queryFn: () => apiFetch<{ items: DictionaryItem[] }>('/api/dictionaries')
  });
  const receiverOptions = useMemo(
    () => (dictionaries.data?.items ?? []).filter((item) => item.code === 'receiver_type'),
    [dictionaries.data]
  );
  const antennaOptions = useMemo(
    () => (dictionaries.data?.items ?? []).filter((item) => item.code === 'antenna_type'),
    [dictionaries.data]
  );

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
        notes: form.notes,
        station_type: form.station_type,
        enabled: form.enabled,
        receiver_type: form.receiver_type,
        receiver_sn: form.receiver_sn,
        receiver_firmware: form.receiver_firmware,
        antenna_type: form.antenna_type,
        antenna_sn: form.antenna_sn,
        antenna_height: form.antenna_height === '' ? null : Number(form.antenna_height),
        elevation_mask: form.elevation_mask === '' ? null : Number(form.elevation_mask),
        contractor: form.contractor,
        region: form.region,
        address: form.address,
        device_id: form.device_id,
        network_type: form.network_type,
        network_mode: form.network_mode,
        protocol: form.protocol
      };
      if (editing) {
        return apiFetch(`/api/stations/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/stations', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
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

  const importMutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<{
        items?: Record<string, unknown>[];
        errors?: string[];
        created?: number;
        updated?: number;
      }>('/api/stations/import', {
        method: 'POST',
        body: { dataBase64: importData, dryRun },
        csrfToken
      }),
    onSuccess: async (result, dryRun) => {
      if (dryRun) {
        setImportPreview({ items: result.items ?? [], errors: result.errors ?? [] });
        return;
      }
      setImportPreview(null);
      setImportFile(null);
      setImportData('');
      if (importRef.current) importRef.current.value = '';
      push(`Import xong: ${result.created ?? 0} thêm, ${result.updated ?? 0} cập nhật`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Import thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(station: Station) {
    setEditing(station);
    setForm(formFromStation(station));
    setError('');
    setDirty(false);
    setFormOpen(true);
    setDetail(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function handleFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      setImportData(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
      setImportFile(file);
      setImportPreview(null);
    };
    reader.readAsDataURL(file);
  }

  async function exportExcel() {
    const response = await fetch(`/api/stations/export?q=${encodeURIComponent(q)}`, {
      credentials: 'include'
    });
    if (!response.ok) {
      push('Export thất bại', 'error');
      return;
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stations-${Date.now()}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="page">
      <PageHeader
        title="Danh sách trạm"
        description="Hồ sơ trạm, thiết bị, kết nối nguồn và chất lượng realtime."
        actions={
          <div className="toolbar">
            {can('stations', 'view') && (
              <Button variant="ghost" onClick={() => void exportExcel()}>
                <Download size={16} aria-hidden="true" /> Excel
              </Button>
            )}
            {can('stations', 'add') && (
              <>
                <input
                  ref={importRef}
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                />
                <Button variant="ghost" onClick={() => importRef.current?.click()}>
                  <Upload size={16} aria-hidden="true" /> Import
                </Button>
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={16} aria-hidden="true" /> Thêm trạm
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mã, tên, địa chỉ" />
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
              key: 'status',
              header: 'Trạng thái',
              cell: (station) => (
                <StatusBadge
                  label={station.quality_state || 'unknown'}
                  kind={stateKind(station.quality_state)}
                />
              )
            },
            {
              key: 'device',
              header: 'Thiết bị',
              hideOnMobile: true,
              cell: (station) => (
                <div>
                  <div>{station.receiver_type || '—'}</div>
                  <div className="muted table-subline">{station.antenna_type || '—'}</div>
                </div>
              )
            },
            {
              key: 'location',
              header: 'Vị trí',
              hideOnMobile: true,
              cell: (station) => (
                <span className="mono">
                  {station.lat ?? '—'}, {station.lon ?? '—'}
                </span>
              )
            },
            {
              key: 'mountpoints',
              header: 'MP',
              align: 'right',
              hideOnMobile: true,
              cell: (station) => station.mountpoint_count ?? 0
            },
            {
              key: 'quality',
              header: 'Chất lượng',
              align: 'right',
              cell: (station) =>
                station.quality_score == null ? (
                  '—'
                ) : (
                  <StatusBadge
                    label={String(station.quality_score)}
                    kind={stateKind(station.quality_state)}
                  />
                )
            },
            {
              key: 'owner',
              header: 'Owner',
              hideOnMobile: true,
              cell: (station) => (
                <span className="muted">{station.owner_name || station.owner_web_user_id || '—'}</span>
              )
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
          if (!open) {
            setDirty(false);
            setEditing(null);
          }
        }}
        title={editing ? 'Sửa trạm' : 'Thêm trạm'}
        description="Thông tin trạm vật lý; không gắn trực tiếp vào relay."
        size="lg"
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
        <form
          id="station-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <fieldset className="form-section">
            <legend>Định danh</legend>
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
            <Field label="Loại trạm">
              <Select
                value={form.station_type}
                onChange={(event) => setForm({ ...form, station_type: event.target.value })}
              >
                <option value="reference">Reference</option>
                <option value="monitor">Monitor</option>
                <option value="relay">Relay source</option>
              </Select>
            </Field>
            <Field label="Bật trạm">
              <Select
                value={form.enabled ? '1' : '0'}
                onChange={(event) => setForm({ ...form, enabled: event.target.value === '1' })}
              >
                <option value="1">Bật</option>
                <option value="0">Tắt</option>
              </Select>
            </Field>
            <Field label="Vùng">
              <Input
                value={form.region}
                onChange={(event) => setForm({ ...form, region: event.target.value })}
              />
            </Field>
            <Field label="Địa chỉ">
              <Input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </Field>
            <Field label="Đơn vị thi công">
              <Input
                value={form.contractor}
                onChange={(event) => setForm({ ...form, contractor: event.target.value })}
              />
            </Field>
          </fieldset>

          <fieldset className="form-section">
            <legend>Vị trí</legend>
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
            <Field label="Elevation mask (°)">
              <Input
                type="number"
                step="0.01"
                value={form.elevation_mask}
                onChange={(event) => setForm({ ...form, elevation_mask: event.target.value })}
              />
            </Field>
          </fieldset>

          <fieldset className="form-section">
            <legend>Thiết bị</legend>
            <Field label="Receiver">
              <Select
                value={form.receiver_type}
                onChange={(event) => setForm({ ...form, receiver_type: event.target.value })}
              >
                <option value="">Chọn receiver</option>
                {receiverOptions.map((item) => (
                  <option key={item.key} value={item.value}>
                    {item.value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Serial receiver">
              <Input
                value={form.receiver_sn}
                onChange={(event) => setForm({ ...form, receiver_sn: event.target.value })}
              />
            </Field>
            <Field label="Firmware">
              <Input
                value={form.receiver_firmware}
                onChange={(event) => setForm({ ...form, receiver_firmware: event.target.value })}
              />
            </Field>
            <Field label="Antenna">
              <Select
                value={form.antenna_type}
                onChange={(event) => setForm({ ...form, antenna_type: event.target.value })}
              >
                <option value="">Chọn antenna</option>
                {antennaOptions.map((item) => (
                  <option key={item.key} value={item.value}>
                    {item.value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Serial antenna">
              <Input
                value={form.antenna_sn}
                onChange={(event) => setForm({ ...form, antenna_sn: event.target.value })}
              />
            </Field>
            <Field label="Chiều cao antenna (m)">
              <Input
                type="number"
                step="0.0001"
                value={form.antenna_height}
                onChange={(event) => setForm({ ...form, antenna_height: event.target.value })}
              />
            </Field>
            <Field label="Device ID">
              <Input
                value={form.device_id}
                onChange={(event) => setForm({ ...form, device_id: event.target.value })}
              />
            </Field>
          </fieldset>

          <fieldset className="form-section">
            <legend>Kết nối</legend>
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
            <Field label="Protocol">
              <Input
                value={form.protocol}
                onChange={(event) => setForm({ ...form, protocol: event.target.value })}
              />
            </Field>
            <Field label="Kiểu kết nối">
              <Input
                value={form.connection_type}
                onChange={(event) => setForm({ ...form, connection_type: event.target.value })}
              />
            </Field>
            <Field label="Network type">
              <Input
                value={form.network_type}
                onChange={(event) => setForm({ ...form, network_type: event.target.value })}
              />
            </Field>
            <Field label="Network mode">
              <Input
                value={form.network_mode}
                onChange={(event) => setForm({ ...form, network_mode: event.target.value })}
              />
            </Field>
            <Field label="Ghi chú">
              <Input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </fieldset>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? 'Chi tiết trạm'}
        description={detail?.code}
        side="right"
        size="lg"
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
              <dt>Trạng thái</dt>
              <dd>
                <StatusBadge
                  label={detail.quality_state || 'unknown'}
                  kind={stateKind(detail.quality_state)}
                />
              </dd>
            </div>
            <div>
              <dt>Vị trí</dt>
              <dd>
                {detail.lat ?? '—'}, {detail.lon ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{detail.owner_name || detail.owner_web_user_id || '—'}</dd>
            </div>
            <div>
              <dt>Receiver</dt>
              <dd>
                {detail.receiver_type || '—'} · {detail.receiver_sn || '—'}
              </dd>
            </div>
            <div>
              <dt>Antenna</dt>
              <dd>
                {detail.antenna_type || '—'} · {detail.antenna_height ?? '—'} m
              </dd>
            </div>
            <div>
              <dt>Vùng</dt>
              <dd>{detail.region || '—'}</dd>
            </div>
            <div>
              <dt>Dữ liệu cuối</dt>
              <dd className="mono">
                {detail.last_data_at
                  ? new Date(detail.last_data_at).toLocaleString('vi-VN')
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Ghi chú</dt>
              <dd>{detail.notes || '—'}</dd>
            </div>
          </dl>
        )}
        {detail && can('quality', 'view') && (
          <QualityPanel key={detail.id} targetType="station" targetId={detail.id} />
        )}
      </Modal>

      <Modal
        open={Boolean(importPreview)}
        onOpenChange={(open) => !open && setImportPreview(null)}
        title={`Preview import${importFile ? ` · ${importFile.name}` : ''}`}
        description="Kiểm tra dữ liệu trước khi ghi."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportPreview(null)}>
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={Boolean(importPreview?.errors.length)}
              loading={importMutation.isPending}
              onClick={() => importMutation.mutate(false)}
            >
              Ghi vào hệ thống
            </Button>
          </>
        }
      >
        {importPreview?.errors.length ? (
          <div className="alert error">
            {importPreview.errors.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        ) : (
          <p className="muted">Hợp lệ {importPreview?.items.length ?? 0} dòng.</p>
        )}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên</th>
                <th>Host</th>
                <th>Receiver</th>
                <th>Vùng</th>
              </tr>
            </thead>
            <tbody>
              {(importPreview?.items ?? []).slice(0, 20).map((row, index) => (
                <tr key={`${row.code}-${index}`}>
                  <td className="mono">{String(row.code ?? '')}</td>
                  <td>{String(row.name ?? '')}</td>
                  <td className="mono">{String(row.host ?? '')}</td>
                  <td>{String(row.receiver_type ?? '')}</td>
                  <td>{String(row.region ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
