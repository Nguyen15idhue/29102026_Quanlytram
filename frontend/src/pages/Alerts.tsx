import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Bell } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useListParams } from '../lib/useListParams';
import type { AlertItem } from '../types';
import {
  Button,
  DataTable,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface AlertList {
  items: AlertItem[];
  total: number;
}

function severityKind(severity: string): 'info' | 'ok' | 'warn' | 'error' | 'neutral' {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warn';
  if (severity === 'info') return 'info';
  return 'neutral';
}

function formatLocal(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

export function Alerts() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { snapshot } = useRealtime();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const status = getParam('status') || 'open';
  const severity = getParam('severity');

  const list = useQuery({
    queryKey: ['alerts', page, pageSize, q, status, severity],
    queryFn: () =>
      apiFetch<AlertList>(
        `/api/alerts?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(
          q
        )}&status=${encodeURIComponent(status)}&severity=${encodeURIComponent(severity)}`
      )
  });

  const openIds = (snapshot?.alerts ?? []).map((alert) => alert.id).join(',');
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  }, [openIds, queryClient]);

  const ack = useMutation({
    mutationFn: (alert: AlertItem) =>
      apiFetch(`/api/alerts/${alert.id}/ack`, { method: 'POST', body: {}, csrfToken }),
    onSuccess: async () => {
      push('Đã xác nhận cảnh báo', 'success');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Xác nhận thất bại', 'error')
  });

  return (
    <section className="page">
      <PageHeader
        title="Cảnh báo"
        description="Cảnh báo vận hành từ relay/caster; xác nhận không tự tắt job."
        actions={<Bell size={20} className="muted" aria-hidden="true" />}
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm cảnh báo" />
          <div className="toolbar">
            <Select
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
              aria-label="Trạng thái cảnh báo"
            >
              <option value="">Tất cả</option>
              <option value="open">Đang mở</option>
              <option value="acked">Đã xác nhận</option>
            </Select>
            <Select
              value={severity}
              onChange={(event) => setParam('severity', event.target.value)}
              aria-label="Mức độ cảnh báo"
            >
              <option value="">Mọi mức độ</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </Select>
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
          </div>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(alert) => alert.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được cảnh báo.' : undefined}
          empty="Không có cảnh báo phù hợp."
          columns={[
            {
              key: 'severity',
              header: 'Mức độ',
              cell: (alert) => (
                <StatusBadge label={alert.severity} kind={severityKind(alert.severity)} />
              )
            },
            {
              key: 'title',
              header: 'Cảnh báo',
              cell: (alert) => (
                <div>
                  <strong>{alert.title}</strong>
                  <div className="muted table-subline">{alert.message || alert.type}</div>
                </div>
              )
            },
            {
              key: 'target',
              header: 'Đối tượng',
              hideOnMobile: true,
              cell: (alert) => (
                <span className="mono">
                  {alert.targetType}
                  {alert.targetId ? ` #${alert.targetId}` : ''}
                </span>
              )
            },
            {
              key: 'created',
              header: 'Thời điểm',
              hideOnMobile: true,
              cell: (alert) => <span className="mono">{formatLocal(alert.createdAt)}</span>
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (alert) => (
                <div>
                  <StatusBadge
                    label={alert.status}
                    kind={alert.status === 'open' ? 'warn' : 'ok'}
                  />
                  {alert.ackedAt && (
                    <div className="muted table-subline">
                      Ack {formatLocal(alert.ackedAt)}
                    </div>
                  )}
                </div>
              )
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (alert) =>
                can('alerts', 'ack') && alert.status === 'open' ? (
                  <IconButton
                    label={`Xác nhận cảnh báo ${alert.id}`}
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(alert)}
                  >
                    <Check size={16} aria-hidden="true" />
                  </IconButton>
                ) : null
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
