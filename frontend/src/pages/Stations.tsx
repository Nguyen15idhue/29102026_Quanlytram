import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { bulkMessage, sendBulk } from '../lib/bulk';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { CasterListener, Station, StationSource } from '../types';
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
import {
  StationDetailDrawer,
  type StationDetailTab
} from '../components/StationDetailDrawer';
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
  source_type: 'manual', ntrip_version: 'v1', ntrip_mode: 'v1_noauth',
  lat: '', lon: '', notes: '', station_type: 'reference', enabled: true,
  coordinate_type: 'wgs84', province: '', ward: '', address_detail: '',
  receiver_type: '', receiver_sn: '', receiver_firmware: '',
  antenna_type: '', antenna_sn: '', antenna_height: '', elevation_mask: '',
  contractor: '', region: '', address: '', device_id: '',
  network_type: '', network_mode: '', protocol: 'ntrip',
  source_role: 'ntrip_caster' as 'ntrip_client' | 'ntrip_caster',
  client_host: '', client_port: 1509, client_mount: '', client_username: '',
  client_password: '', client_tls: false, client_send_gga: false,
  client_nmea_interval_sec: 0, client_gga_lat: '', client_gga_lon: '',
  caster_version: 'v2' as 'v1' | 'v2',
  caster_username: '', caster_password: '', caster_requires_auth: true,
  caster_listener_id: '' as string | number
};

function formFromStation(station: Station) {
  return {
    ...emptyForm,
    code: station.code,
    coordinate_type: station.coordinate_type ?? 'wgs84',
    province: station.province ?? '',
    ward: station.ward ?? '',
    address_detail: station.address_detail ?? '',
    name: station.name,
    host: station.host,
    port: station.port,
    connection_type: station.connection_type,
    source_type: station.source_type ?? 'manual',
    ntrip_version: station.ntrip_version ?? 'v1',
    ntrip_mode: station.ntrip_mode ?? 'v1_noauth',
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

function formatLocal(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

const DETAIL_TABS: StationDetailTab[] = [
  'overview',
  'connection',
  'quality',
  'metadata',
  'history'
];

function parseDetailTab(value: string | null): StationDetailTab {
  return DETAIL_TABS.includes(value as StationDetailTab)
    ? (value as StationDetailTab)
    : 'overview';
}

export function Stations() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { stationId: routeStationId } = useParams();
  const [searchParams] = useSearchParams();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const region = getParam('region');
  const sourceType = getParam('sourceType');
  const enabled = getParam('enabled');
  const owner = getParam('owner');
  const activeFilterCount = [region, sourceType, enabled, owner].filter(Boolean).length;
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  useDirtyGuard(dirty && formOpen);
  const stationId = Number(routeStationId);
  const detailId = Number.isInteger(stationId) && stationId > 0 ? stationId : null;
  const detailTab = parseDetailTab(searchParams.get('tab'));
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState('');
  const [importPreview, setImportPreview] = useState<{
    items: Record<string, unknown>[];
    errors: string[];
  } | null>(null);
  const [mountpointOptions, setMountpointOptions] = useState<string[]>([]);
  const [mountpointLoading, setMountpointLoading] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (region) params.set('region', region);
    if (sourceType) params.set('sourceType', sourceType);
    if (enabled) params.set('enabled', enabled);
    if (owner) params.set('owner', owner);
    return params.toString();
  }, [page, pageSize, q, region, sourceType, enabled, owner]);
  const list = useQuery({
    queryKey: ['stations', listQuery],
    queryFn: () => apiFetch<StationList>(`/api/stations?${listQuery}`)
  });
  const owners = useQuery({
    queryKey: ['web-users', 'station-filter'],
    queryFn: () =>
      apiFetch<{
        items: Array<{ id: number; username: string; displayName?: string; display_name?: string }>;
      }>('/api/web-users?pageSize=50'),
    enabled: can('web_users', 'view')
  });

  const sources = useQuery({
    queryKey: ['station-sources', editing?.id],
    queryFn: () =>
      apiFetch<{ items: StationSource[] }>(`/api/stations/${editing?.id}/sources`),
    enabled: Boolean(editing?.id)
  });

  useEffect(() => {
    const source = sources.data?.items[0];
    if (!source) return;
    setForm((current) => ({
      ...current,
      source_role: source.source_role,
      client_host: source.client_host,
      client_port: source.client_port,
      client_mount: source.client_mount,
      client_username: source.client_username,
      client_password: '',
      client_tls: source.client_tls,
      client_send_gga: source.client_send_gga,
      client_nmea_interval_sec: source.client_nmea_interval_sec,
      client_gga_lat: source.client_gga_lat == null ? '' : String(source.client_gga_lat),
      client_gga_lon: source.client_gga_lon == null ? '' : String(source.client_gga_lon),
      caster_version: source.caster_version,
      caster_username: source.caster_username,
      caster_password: '',
      caster_requires_auth: source.caster_requires_auth,
      caster_listener_id: source.caster_listener_id ?? ''
    }));
  }, [sources.data]);

  const sourceListeners = useQuery({
    queryKey: ['caster-listeners', 'station-source'],
    queryFn: () =>
      apiFetch<{ items: CasterListener[] }>('/api/caster/listeners?page=1&pageSize=100'),
    enabled: formOpen && can('caster', 'view')
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
        ...(editing ? { code: form.code } : {}),
        name: form.name,
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
        coordinate_type: form.coordinate_type,
        province: form.province,
        ward: form.ward,
        address_detail: form.address_detail
      };
      const saved = editing
        ? await apiFetch<{ item: Station }>(`/api/stations/${editing.id}`, {
            method: 'PATCH',
            body,
            csrfToken
          })
        : await apiFetch<{ item: Station }>('/api/stations', {
            method: 'POST',
            body,
            csrfToken
          });
      await apiFetch(`/api/stations/${saved.item.id}/sources`, {
        method: 'PUT',
        csrfToken,
        body: {
          source_role: form.source_role,
          client_host: form.client_host,
          client_port: Number(form.client_port),
          client_mount: form.client_mount,
          client_username: form.client_username,
          ...(form.client_password ? { client_password: form.client_password } : {}),
          client_tls: form.client_tls,
          client_send_gga: form.client_send_gga,
          client_nmea_interval_sec: Number(form.client_nmea_interval_sec),
          client_gga_lat:
            form.client_send_gga && form.client_gga_lat !== ''
              ? Number(form.client_gga_lat)
              : null,
          client_gga_lon:
            form.client_send_gga && form.client_gga_lon !== ''
              ? Number(form.client_gga_lon)
              : null,
          caster_version: form.caster_version,
          caster_username: form.caster_username,
          ...(form.caster_password ? { caster_password: form.caster_password } : {}),
          caster_requires_auth: form.caster_requires_auth,
          caster_listener_id:
            form.caster_listener_id === '' ? null : Number(form.caster_listener_id)
        }
      });
      return saved;
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
      closeDetail();
      push('Đã xóa trạm', 'success');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Xóa thất bại', 'error')
  });

  const bulk = useMutation({
    mutationFn: (action: string) =>
      sendBulk('/api/stations/bulk', action, [...selected], csrfToken),
    onSuccess: async (result, action) => {
      setSelected(new Set());
      setBulkDeleteOpen(false);
      closeDetail();
      push(bulkMessage(result), result.forbidden || result.notFound ? 'error' : 'success');
      if (action === 'delete') push('Đã xóa các trạm đã chọn', 'success');
      await queryClient.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Thao tác hàng loạt thất bại', 'error')
  });

  useEffect(() => {
    setSelected(new Set());
  }, [page, pageSize, q, region, sourceType, enabled, owner]);

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

  function openDetail(station: Station, tab: StationDetailTab = 'overview') {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    navigate({
      pathname: `/stations/${station.id}`,
      search: next.toString()
    });
  }

  function closeDetail() {
    if (!detailId) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    navigate({
      pathname: '/stations',
      search: next.toString()
    });
  }

  function changeDetailTab(tab: StationDetailTab) {
    if (!detailId) return;
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    navigate(
      {
        pathname: `/stations/${detailId}`,
        search: next.toString()
      },
      { replace: true }
    );
  }

  async function loadClientMountpoints() {
    if (!form.client_host.trim()) {
      push('Nhập host NTRIP client trước', 'error');
      return;
    }
    setMountpointLoading(true);
    try {
      const data = await apiFetch<{ items: Array<{ name: string }> }>(
        '/api/stations/source/mountpoints',
        {
          method: 'POST',
          csrfToken,
          body: {
            host: form.client_host,
            port: Number(form.client_port),
            tls: form.client_tls,
            username: form.client_username,
            password: form.client_password,
            stationId: editing?.id
          }
        }
      );
      const names = data.items.map((item) => item.name);
      setMountpointOptions(names);
      if (names.length === 1) setForm({ ...form, client_mount: names[0] });
      push(
        names.length ? `Tải được ${names.length} mountpoint` : 'Sourcetable không có mountpoint',
        names.length ? 'success' : 'error'
      );
    } catch (err) {
      push(err instanceof ApiClientError ? err.message : 'Tải mountpoint thất bại', 'error');
    } finally {
      setMountpointLoading(false);
    }
  }

  async function fillAddress() {
    const lat = editing?.reported_lat ?? (form.lat === '' ? NaN : Number(form.lat));
    const lon = editing?.reported_lon ?? (form.lon === '' ? NaN : Number(form.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      push('Chưa có tọa độ 1005/1006 để tra địa chỉ', 'error');
      return;
    }
    try {
      const data = await apiFetch<{
        item: {
          province: string;
          ward: string;
          addressDetail: string;
          source: 'geoapify' | 'nominatim' | 'fallback';
        };
      }>(`/api/geo/reverse?lat=${lat}&lon=${lon}`);
      if (!data.item.province && !data.item.ward && !data.item.addressDetail) {
        push('Không tìm thấy địa chỉ cho tọa độ này', 'error');
        return;
      }
      setForm((current) => ({
        ...current,
        province: data.item.province || current.province,
        ward: data.item.ward || current.ward,
        address_detail: data.item.addressDetail || current.address_detail
      }));
      setDirty(true);
      push(
        data.item.source === 'fallback'
          ? 'Đã điền địa chỉ từ dữ liệu dự phòng'
          : 'Đã tra địa chỉ từ tọa độ',
        'success'
      );
    } catch (err) {
      push(err instanceof ApiClientError ? err.message : 'Tra địa chỉ thất bại', 'error');
    }
  }

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
    closeDetail();
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
    const response = await fetch(`/api/stations/export?${listQuery}`, {
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
        <TableToolbar
          search={
            <SearchInput value={q} onChange={setQ} placeholder="Tìm mã, tên, địa chỉ" />
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Vùng">
            <Input
              value={region}
              onChange={(event) => setParam('region', event.target.value || null)}
              placeholder="Ví dụ: Hà Nội"
            />
          </Field>
          <Field label="Nguồn dữ liệu">
            <Select
              value={sourceType}
              onChange={(event) => setParam('sourceType', event.target.value || null)}
            >
              <option value="">Mọi nguồn</option>
              <option value="relay_caster">NTRIP caster (relay)</option>
              <option value="caster_ingest">NTRIP caster (ingest)</option>
              <option value="probe_client">NTRIP client (probe)</option>
              <option value="manual">Thủ công</option>
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
          {can('web_users', 'view') && (
            <Field label="Owner">
              <Select
                value={owner}
                onChange={(event) => setParam('owner', event.target.value || null)}
              >
                <option value="">Mọi owner</option>
                {(owners.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName || item.display_name || item.username}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </TableToolbar>
        <BulkActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          actions={[
            ...(can('stations', 'edit')
              ? [
                  { label: 'Bật', onClick: () => bulk.mutate('enable') },
                  { label: 'Tắt', onClick: () => bulk.mutate('disable') },
                  { label: 'Khóa', onClick: () => bulk.mutate('lock') },
                  { label: 'Mở khóa', onClick: () => bulk.mutate('unlock') }
                ]
              : []),
            ...(can('stations', 'delete')
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
          rowKey={(station) => station.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          selectionLabel={(station) => `trạm ${station.name}`}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được danh sách trạm.' : undefined}
          empty="Chưa có trạm nào."
          onRowClick={(station) => openDetail(station)}
          columns={[
            {
              key: 'name',
              header: 'Tên',
              cell: (station) => (
                <div>
                  <div>{station.name}</div>
                  <div className="muted table-subline">
                    {station.owner_name || station.owner_web_user_id || '—'}
                  </div>
                </div>
              )
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (station) => {
                const status = station.status ?? (station.enabled ? 'active' : 'disabled');
                return (
                  <StatusBadge
                    label={status}
                    kind={status === 'active' ? 'ok' : status === 'locked' ? 'warn' : 'neutral'}
                  />
                );
              }
            },
            {
              key: 'source',
              header: 'Nguồn',
              hideOnMobile: true,
              cell: (station) => (
                <div>
                  <div>
                    {station.station_source_role === 'ntrip_client'
                      ? 'NTRIP client'
                      : station.station_source_role === 'ntrip_caster'
                        ? 'NTRIP caster'
                        : '—'}
                  </div>
                  <div className="muted table-subline">
                    {station.station_source_role === 'ntrip_client'
                      ? `${station.station_client_host ?? '—'}:${
                          station.station_client_port ?? '—'
                        }/${station.station_client_mount ?? '—'}`
                      : station.station_caster_port
                        ? `listener :${station.station_caster_port}`
                        : '—'}
                  </div>
                </div>
              )
            },
            {
              key: 'device',
              header: 'Thiết bị',
              hideOnMobile: true,
              cell: (station) => (
                <div>
                  <div>{station.receiver_type || '—'}</div>
                  <div className="muted table-subline">
                    SN {station.receiver_sn || '—'} · antenna {station.antenna_type || '—'}
                  </div>
                </div>
              )
            },
            {
              key: 'location',
              header: 'Vị trí',
              hideOnMobile: true,
              cell: (station) =>
                station.reported_lat == null || station.reported_lon == null ? (
                  <span className="muted">Chưa 1005</span>
                ) : (
                  <div>
                    <div className="mono">
                      {station.reported_lat.toFixed(6)}, {station.reported_lon.toFixed(6)}
                    </div>
                    <div className="muted table-subline">
                      h {station.reported_height?.toFixed(2) ?? '—'} m
                    </div>
                  </div>
                )
            },
            {
              key: 'mountpoints',
              header: 'MP',
              align: 'right',
              hideOnMobile: true,
              cell: (station) => (
                <div>
                  <div className="mono align-right">{station.mountpoint_count ?? 0}</div>
                  <div className="muted table-subline">
                    {station.probe_enabled
                      ? `probe ${station.probe_interval_sec ?? '—'}s`
                      : 'probe off'}
                  </div>
                </div>
              )
            },
            {
              key: 'lastData',
              header: 'Dữ liệu cuối',
              hideOnMobile: true,
              cell: (station) => (
                <span className="mono muted">{formatLocal(station.last_data_at)}</span>
              )
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
              key: 'actions',
              header: '',
              align: 'right',
              cell: (station) => (
                <div className="row-actions">
                  {can('stations', 'edit') && (
                    <IconButton
                      label={`Sửa ${station.name}`}
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
                      label={`Xóa ${station.name}`}
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
        description="Thông tin trạm vật lý; nguồn relay/caster chỉ đọc từ cấu hình relay."
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
            <legend>Thông tin cơ bản</legend>
            <Field label="Tên trạm" error={error || undefined}>
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

          {editing && (
            <fieldset className="form-section">
              <legend>Vị trí</legend>
              <Field label="Hệ tọa độ">
                <Select
                  value={form.coordinate_type}
                  onChange={(event) => setForm({ ...form, coordinate_type: event.target.value })}
                >
                  <option value="wgs84">WGS84</option>
                  <option value="vn2000">VN2000</option>
                  <option value="itrf">ITRF</option>
                </Select>
              </Field>
              {form.coordinate_type === 'wgs84' && (
                <>
                  <Field label="Vĩ độ WGS84">
                    <Input
                      readOnly
                      value={
                        editing?.reported_lat != null
                          ? editing.reported_lat.toFixed(7)
                          : '—'
                      }
                      placeholder="Chờ message 1005/1006"
                    />
                  </Field>
                  <Field label="Kinh độ WGS84">
                    <Input
                      readOnly
                      value={
                        editing?.reported_lon != null
                          ? editing.reported_lon.toFixed(7)
                          : '—'
                      }
                      placeholder="Chờ message 1005/1006"
                    />
                  </Field>
                  <Field label="Cao độ WGS84 (m)">
                    <Input
                      readOnly
                      value={
                        editing?.reported_height != null
                          ? editing.reported_height.toFixed(3)
                          : '—'
                      }
                    />
                  </Field>
                </>
              )}
              {form.coordinate_type === 'vn2000' && (
                <>
                  <Field label="VN2000 X / Easting (m)">
                    <Input
                      readOnly
                      value={
                        editing?.vn2000_easting != null
                          ? editing.vn2000_easting.toFixed(3)
                          : '—'
                      }
                    />
                  </Field>
                  <Field label="VN2000 Y / Northing (m)">
                    <Input
                      readOnly
                      value={
                        editing?.vn2000_northing != null
                          ? editing.vn2000_northing.toFixed(3)
                          : '—'
                      }
                    />
                  </Field>
                  <Field label="Cao độ (m)">
                    <Input
                      readOnly
                      value={
                        editing?.reported_height != null
                          ? editing.reported_height.toFixed(3)
                          : '—'
                      }
                    />
                  </Field>
                </>
              )}
              {form.coordinate_type === 'itrf' && (
                <>
                  <Field label="ITRF X (m)">
                    <Input
                      readOnly
                      value={editing?.itrf_x != null ? editing.itrf_x.toFixed(3) : '—'}
                    />
                  </Field>
                  <Field label="ITRF Y (m)">
                    <Input
                      readOnly
                      value={editing?.itrf_y != null ? editing.itrf_y.toFixed(3) : '—'}
                    />
                  </Field>
                  <Field label="Cao độ (m)">
                    <Input
                      readOnly
                      value={
                        editing?.reported_height != null
                          ? editing.reported_height.toFixed(3)
                          : '—'
                      }
                    />
                  </Field>
                </>
              )}
              <Field label="Tỉnh/thành">
                <Input
                  value={form.province}
                  onChange={(event) => setForm({ ...form, province: event.target.value })}
                />
              </Field>
              <Field label="Phường/xã">
                <Input
                  value={form.ward}
                  onChange={(event) => setForm({ ...form, ward: event.target.value })}
                />
              </Field>
              <Field label="Địa chỉ chi tiết">
                <Input
                  value={form.address_detail}
                  onChange={(event) => setForm({ ...form, address_detail: event.target.value })}
                />
              </Field>
              <Field label="Tra địa chỉ">
                <Button
                  type="button"
                  size="sm"
                  aria-label="Lấy địa chỉ từ tọa độ"
                  onClick={fillAddress}
                >
                  Lấy địa chỉ từ tọa độ
                </Button>
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
          )}

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
            <legend>Thông tin kết nối</legend>
            <Field label="Vai trò nguồn">
              <Select
                value={form.source_role}
                onChange={(event) =>
                  setForm({ ...form, source_role: event.target.value as 'ntrip_client' | 'ntrip_caster' })
                }
              >
                <option value="ntrip_caster">NTRIP caster</option>
                <option value="ntrip_client">NTRIP client</option>
              </Select>
            </Field>
            {form.source_role === 'ntrip_client' ? (
              <>
                <Field label="Client host">
                  <Input
                    value={form.client_host}
                    onChange={(event) => setForm({ ...form, client_host: event.target.value })}
                  />
                </Field>
                <Field label="Client port">
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.client_port}
                    onChange={(event) =>
                      setForm({ ...form, client_port: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Client mountpoint">
                  <div className="toolbar">
                    <Select
                      value={form.client_mount}
                      onChange={(event) => setForm({ ...form, client_mount: event.target.value })}
                    >
                      <option value="">— Chọn mountpoint —</option>
                      {mountpointOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={mountpointLoading}
                      onClick={loadClientMountpoints}
                    >
                      Tải mountpoint
                    </Button>
                  </div>
                </Field>
                <Field label="Client username">
                  <Input
                    value={form.client_username}
                    onChange={(event) =>
                      setForm({ ...form, client_username: event.target.value })
                    }
                  />
                </Field>
                <Field label="Client password">
                  <Input
                    type="password"
                    value={form.client_password}
                    placeholder={sources.data?.items[0]?.client_has_password ? 'Đã đặt mật khẩu' : ''}
                    onChange={(event) =>
                      setForm({ ...form, client_password: event.target.value })
                    }
                  />
                </Field>
                <Field label="TLS">
                  <Select
                    value={form.client_tls ? '1' : '0'}
                    onChange={(event) =>
                      setForm({ ...form, client_tls: event.target.value === '1' })
                    }
                  >
                    <option value="0">Không</option>
                    <option value="1">Có</option>
                  </Select>
                </Field>
                <Field label="Gửi GGA">
                  <Select
                    value={form.client_send_gga ? '1' : '0'}
                    onChange={(event) =>
                      setForm({ ...form, client_send_gga: event.target.value === '1' })
                    }
                  >
                    <option value="0">Không</option>
                    <option value="1">Có</option>
                  </Select>
                </Field>
                <Field label="Chu kỳ GGA (giây)">
                  <Input
                    type="number"
                    min={0}
                    max={3600}
                    value={form.client_nmea_interval_sec}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        client_nmea_interval_sec: Number(event.target.value)
                      })
                    }
                  />
                </Field>
                {form.client_send_gga && (
                  <>
                    <Field label="GGA vĩ độ">
                      <Input
                        type="number"
                        step="0.0000001"
                        value={form.client_gga_lat}
                        onChange={(event) =>
                          setForm({ ...form, client_gga_lat: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="GGA kinh độ">
                      <Input
                        type="number"
                        step="0.0000001"
                        value={form.client_gga_lon}
                        onChange={(event) =>
                          setForm({ ...form, client_gga_lon: event.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="Caster version">
                  <Select
                    value={form.caster_version}
                    onChange={(event) =>
                      setForm({ ...form, caster_version: event.target.value as 'v1' | 'v2' })
                    }
                  >
                    <option value="v1">v1</option>
                    <option value="v2">v2</option>
                  </Select>
                </Field>
                <Field label="Listener / port">
                  <Select
                    value={form.caster_listener_id}
                    onChange={(event) =>
                      setForm({ ...form, caster_listener_id: event.target.value })
                    }
                  >
                    <option value="">— Chọn listener —</option>
                    {(sourceListeners.data?.items ?? []).map((listener) => (
                      <option key={listener.id} value={listener.id}>
                        {listener.name} · :{listener.port}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Port">
                  <Input
                    readOnly
                    value={
                      sourceListeners.data?.items.find(
                        (listener) => String(listener.id) === String(form.caster_listener_id)
                      )?.port ?? ''
                    }
                  />
                </Field>
                <Field label="Caster username">
                  <Input
                    value={form.caster_username}
                    onChange={(event) =>
                      setForm({ ...form, caster_username: event.target.value })
                    }
                  />
                </Field>
                <Field label="Caster password">
                  <Input
                    type="password"
                    value={form.caster_password}
                    placeholder={sources.data?.items[0]?.caster_has_password ? 'Đã đặt mật khẩu' : ''}
                    onChange={(event) =>
                      setForm({ ...form, caster_password: event.target.value })
                    }
                  />
                </Field>
                <Field label="Yêu cầu xác thực">
                  <Select
                    value={form.caster_requires_auth ? '1' : '0'}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        caster_requires_auth: event.target.value === '1'
                      })
                    }
                  >
                    <option value="1">Có</option>
                    <option value="0">Không</option>
                  </Select>
                </Field>
              </>
            )}
            <Field label="Ghi chú">
              <Input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </fieldset>

          {editing && (
            <fieldset className="form-section">
              <legend>Hệ thống (chỉ đọc)</legend>
              <Field label="ID">
                <Input readOnly value={editing.id} />
              </Field>
              <Field label="Mã nội bộ">
                <Input readOnly value={editing.code} />
              </Field>
              <Field label="Trạng thái">
                <Input readOnly value={editing.status ?? (editing.enabled ? 'active' : 'disabled')} />
              </Field>
              <Field label="Người tạo">
                <Input readOnly value={editing.created_by ?? '—'} />
              </Field>
              <Field label="Tạo lúc">
                <Input readOnly value={editing.created_at ?? '—'} />
              </Field>
              <Field label="Cập nhật lúc">
                <Input readOnly value={editing.updated_at ?? '—'} />
              </Field>
              <Field label="Dữ liệu cuối">
                <Input readOnly value={editing.last_data_at ?? '—'} />
              </Field>
            </fieldset>
          )}
        </form>
      </Modal>

      {detailId && (
        <StationDetailDrawer
          stationId={detailId}
          tab={detailTab}
          onTabChange={changeDetailTab}
          onClose={closeDetail}
          onEdit={openEdit}
        />
      )}

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
                <th className="index-col">STT</th>
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
                  <td className="index-col">{index + 1}</td>
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
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Xóa các trạm đã chọn?"
        description={`${selected.size} trạm sẽ bị xóa. Hành động này không thể hoàn tác.`}
        pending={bulk.isPending}
        onConfirm={() => bulk.mutate('delete')}
      />
    </section>
  );
}
