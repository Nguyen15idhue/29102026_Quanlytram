import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Bell } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useListParams } from '../lib/useListParams';
import type { AlertItem } from '../types';
import {
  BulkActionBar,
  Button,
  DataTable,
  Field,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  TableToolbar
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface AlertList {
  items: AlertItem[];
  total: number;
}

function levelKind(level?: string): 'info' | 'ok' | 'warn' | 'error' | 'neutral' {
  if (level === 'critical') return 'error';
  if (level === 'major') return 'warn';
  if (level === 'minor') return 'info';
  if (level === 'info') return 'neutral';
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
  const level = getParam('level');
  const unread = getParam('unread');
  const activeFilterCount = [
    severity,
    level,
    unread,
    status !== 'open' ? status : ''
  ].filter(Boolean).length;
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const list = useQuery({
    queryKey: ['alerts', page, pageSize, q, status, severity, level, unread],
    queryFn: () =>
      apiFetch<AlertList>(
        `/api/alerts?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(
          q
        )}&status=${encodeURIComponent(status)}&severity=${encodeURIComponent(
          severity
        )}&level=${encodeURIComponent(level)}&unread=${encodeURIComponent(unread)}`
      )
  });

  const openIds = (snapshot?.alerts ?? []).map((alert) => alert.id).join(',');
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  }, [openIds, queryClient]);

  const readAll = useMutation({
    mutationFn: () => apiFetch('/api/alerts/read-all', { method: 'POST', body: {}, csrfToken }),
    onSuccess: async () => {
      push('Đã đánh dấu đã đọc', 'success');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Đánh dấu thất bại', 'error')
  });

  const bulkAck = useMutation({
    mutationFn: () =>
      apiFetch<{ result: { updated: number; skipped: number; forbidden: number; notFound: number } }>(
        '/api/alerts/bulk-ack',
        {
          method: 'POST',
          body: { ids: [...selected].map(Number) },
          csrfToken
        }
      ),
    onSuccess: async (data) => {
      setSelected(new Set());
      push(
        `Đã xác nhận ${data.result.updated} cảnh báo${
          data.result.forbidden || data.result.notFound
            ? ` · ${data.result.forbidden} không có quyền · ${data.result.notFound} không tìm thấy`
            : ''
        }`,
        data.result.forbidden || data.result.notFound ? 'error' : 'success'
      );
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Xác nhận hàng loạt thất bại', 'error')
  });

  useEffect(() => {
    setSelected(new Set());
  }, [page, pageSize, q, status, severity, level, unread]);

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
        <TableToolbar
          search={<SearchInput value={q} onChange={setQ} placeholder="Tìm cảnh báo" />}
          activeFilterCount={activeFilterCount}
          actions={
            <>
              <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
                Tải lại
              </Button>
              {can('alerts', 'view') && (
                <Button
                  variant="ghost"
                  onClick={() => readAll.mutate()}
                  loading={readAll.isPending}
                >
                  Đánh dấu đã đọc
                </Button>
              )}
            </>
          }
        >
          <Field label="Trạng thái">
            <Select
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
              aria-label="Trạng thái cảnh báo"
            >
              <option value="">Tất cả</option>
              <option value="open">Đang mở</option>
              <option value="acked">Đã xác nhận</option>
            </Select>
          </Field>
          <Field label="Mức độ">
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
          </Field>
          <Field label="Level">
            <Select
              value={level}
              onChange={(event) => setParam('level', event.target.value)}
              aria-label="Level cảnh báo"
            >
              <option value="">Mọi level</option>
              <option value="critical">critical</option>
              <option value="major">major</option>
              <option value="minor">minor</option>
              <option value="info">info</option>
            </Select>
          </Field>
          <Field label="Đã đọc">
            <Select
              value={unread}
              onChange={(event) => setParam('unread', event.target.value)}
              aria-label="Trạng thái đọc"
            >
              <option value="">Tất cả</option>
              <option value="1">Chưa đọc</option>
            </Select>
          </Field>
        </TableToolbar>
        <BulkActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          actions={
            can('alerts', 'ack')
              ? [{ label: 'Xác nhận', variant: 'primary', onClick: () => bulkAck.mutate() }]
              : []
          }
        />
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(alert) => alert.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          selectionLabel={(alert) => `cảnh báo ${alert.title}`}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được cảnh báo.' : undefined}
          empty="Không có cảnh báo phù hợp."
          columns={[
            {
              key: 'severity',
              header: 'Mức độ',
              cell: (alert) => (
                <div>
                  <StatusBadge
                    label={alert.level ?? alert.severity}
                    kind={levelKind(alert.level ?? alert.severity)}
                  />
                  {alert.unread && (
                    <div className="muted table-subline">chưa đọc</div>
                  )}
                </div>
              )
            },
            {
              key: 'title',
              header: 'Cảnh báo',
              cell: (alert) => (
                <div>
                  <strong>{alert.title}</strong>
                  <div className="muted table-subline">
                    {alert.eventType || alert.type} · {alert.message || alert.title}
                  </div>
                </div>
              )
            },
            {
              key: 'target',
              header: 'Đối tượng',
              hideOnMobile: true,
              cell: (alert) => (
                <div>
                  <div className="mono">
                    {alert.targetType}
                    {alert.targetId ? ` #${alert.targetId}` : ''}
                  </div>
                  <div className="muted table-subline">
                    Owner {alert.ownerWebUserId ?? '—'}
                  </div>
                </div>
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
                      {alert.ackedBy ? ` · #${alert.ackedBy}` : ''}
                    </div>
                  )}
                  {alert.ackNote && (
                    <div className="muted table-subline">{alert.ackNote}</div>
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
