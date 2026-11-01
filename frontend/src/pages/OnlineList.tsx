import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Unplug } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useListParams } from '../lib/useListParams';
import type { CasterConnection } from '../types';
import {
  Button,
  DataTable,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface ConnectionList {
  items: CasterConnection[];
  total: number;
}

function formatLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

export function OnlineList() {
  const { can, csrfToken } = useAuth();
  const { connected } = useRealtime();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();

  const list = useQuery({
    queryKey: ['online-connections', page, pageSize, q],
    queryFn: () =>
      apiFetch<ConnectionList>(
        `/api/connections?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      ),
    refetchInterval: connected ? false : 5000
  });

  const disconnect = useMutation({
    mutationFn: (connection: CasterConnection) =>
      apiFetch(`/api/connections/${connection.id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      push('Đã ngắt kết nối', 'success');
      await queryClient.invalidateQueries({ queryKey: ['online-connections'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Ngắt kết nối thất bại', 'error')
  });

  return (
    <section className="page">
      <PageHeader
        title="Danh sách online"
        description="Tài khoản NTRIP đang kết nối caster, kèm trạng thái tọa độ."
        actions={<Unplug size={20} className="muted" aria-hidden="true" />}
      />
      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm tài khoản, mountpoint, IP" />
          <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
            Tải lại
          </Button>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(item) => item.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được danh sách online.' : undefined}
          empty="Chưa có tài khoản online."
          columns={[
            {
              key: 'account',
              header: 'Tài khoản',
              cell: (item) => (
                <div>
                  <strong>{item.accountUsername || '—'}</strong>
                  <div className="muted table-subline">{item.direction}</div>
                </div>
              )
            },
            {
              key: 'mountpoint',
              header: 'Mountpoint',
              cell: (item) => <span className="mono">{item.mountpointName}</span>
            },
            {
              key: 'listener',
              header: 'Caster',
              hideOnMobile: true,
              cell: (item) => item.listenerName || `#${item.listenerId}`
            },
            {
              key: 'remote',
              header: 'Remote IP',
              hideOnMobile: true,
              cell: (item) => (
                <div>
                  <span className="mono">{item.remoteAddr || '—'}</span>
                  {item.userAgent && (
                    <div className="muted table-subline">{item.userAgent}</div>
                  )}
                </div>
              )
            },
            {
              key: 'start',
              header: 'Bắt đầu',
              hideOnMobile: true,
              cell: (item) => {
                const seconds = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(item.startTs).getTime()) / 1000)
                );
                return (
                  <div>
                    <div className="mono">{formatLocal(item.startTs)}</div>
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
              header: 'In / Out',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => (
                <span className="mono">
                  {item.bytesIn} / {item.bytesOut}
                </span>
              )
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: () => <StatusBadge label="online" kind="ok" />
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (item) =>
                can('connections', 'delete') && (
                  <IconButton
                    label={`Ngắt kết nối ${item.accountUsername}`}
                    onClick={() => disconnect.mutate(item)}
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
      </div>
    </section>
  );
}
