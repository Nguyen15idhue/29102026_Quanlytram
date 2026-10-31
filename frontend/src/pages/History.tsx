import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useListParams } from '../lib/useListParams';
import type {
  AuditLog,
  RelayEvent,
  RelayHourly,
  RelayJob,
  RelaySession
} from '../types';
import {
  Button,
  DataTable,
  Field,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  TableToolbar,
  Tabs
} from '../components/ui';

type Row = RelaySession | RelayEvent | RelayHourly;

interface HistoryList {
  items: Row[];
  total: number;
}

interface AuditList {
  items: AuditLog[];
  total: number;
}

interface RelayJobList {
  items: RelayJob[];
}

type TabValue = 'sessions' | 'events' | 'hourly' | 'audit';

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

function toIso(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function closeKind(reason: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (reason === 'deleted' || reason === 'disabled' || reason === 'config_changed') return 'neutral';
  if (reason === 'auth_failed' || reason === 'timeout' || reason === 'network') return 'error';
  if (reason === 'service_restart') return 'warn';
  return 'ok';
}

export function History() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabValue>('sessions');
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } = useListParams();
  const jobId = getParam('jobId');
  const from = getParam('from');
  const to = getParam('to');
  const activeFilterCount = [from, to].filter(Boolean).length;

  const jobs = useQuery({
    queryKey: ['relay-jobs', 'history-options'],
    queryFn: () => apiFetch<RelayJobList>('/api/relay-jobs?pageSize=50')
  });

  const list = useQuery({
    queryKey: ['relay-history', tab, page, pageSize, jobId, from, to],
    enabled: tab !== 'audit',
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (jobId) params.set('jobId', jobId);
      if (from) params.set('from', toIso(from));
      if (to) params.set('to', toIso(to));
      return apiFetch<HistoryList>(`/api/history/${tab}?${params.toString()}`);
    }
  });

  const audit = useQuery({
    queryKey: ['audit-logs', page, pageSize, q, from, to],
    enabled: tab === 'audit' && can('audit', 'view'),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (q) params.set('q', q);
      if (from) params.set('from', toIso(from));
      if (to) params.set('to', toIso(to));
      return apiFetch<AuditList>(`/api/audit-logs?${params.toString()}`);
    }
  });

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <section className="page">
      <PageHeader
        title={tab === 'audit' ? 'Lịch sử thao tác' : 'Lịch sử relay'}
        description={
          tab === 'audit'
            ? 'Audit thao tác quản trị, đã redact secret.'
            : 'Phiên, sự kiện và thống kê giờ theo phạm vi quyền.'
        }
        actions={<HistoryIcon size={20} className="muted" aria-hidden="true" />}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sessions', label: 'Phiên' },
          { value: 'events', label: 'Sự kiện' },
          { value: 'hourly', label: 'Theo giờ' },
          ...(can('audit', 'view')
            ? [{ value: 'audit' as const, label: 'Audit' }]
            : [])
        ]}
      />

      <div className="panel">
        <TableToolbar
          search={
            tab === 'audit' ? (
              <SearchInput
                value={q}
                onChange={setQ}
                placeholder="Người dùng, hành động, đối tượng"
              />
            ) : (
              <Select
                aria-label="Lọc relay job"
                value={jobId}
                onChange={(event) => setParam('jobId', event.target.value)}
              >
                <option value="">Tất cả relay job</option>
                {jobs.data?.items.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </Select>
            )
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Từ (giờ máy)">
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setParam('from', event.target.value)}
            />
          </Field>
          <Field label="Đến (giờ máy)">
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setParam('to', event.target.value)}
            />
          </Field>
        </TableToolbar>

        {tab === 'sessions' && (
          <DataTable
            items={list.data?.items ?? []}
            rowKey={(row) => `s-${(row as RelaySession).id}`}
            loading={list.isLoading}
            error={list.isError ? 'Không tải được lịch sử phiên.' : undefined}
            empty="Chưa có phiên relay."
            columns={[
              {
                key: 'job',
                header: 'Relay job',
                cell: (row) => <strong>{(row as RelaySession).jobName}</strong>
              },
              {
                key: 'start',
                header: 'Bắt đầu',
                cell: (row) => (
                  <div>
                    <div className="mono">{formatLocal((row as RelaySession).startTs)}</div>
                    <div className="muted table-subline">
                      Kết thúc {formatLocal((row as RelaySession).endTs)}
                    </div>
                  </div>
                )
              },
              {
                key: 'duration',
                header: 'Thời lượng',
                align: 'right',
                hideOnMobile: true,
                cell: (row) => {
                  const value = (row as RelaySession).durationSec;
                  return <span className="mono">{value === null ? '—' : `${value}s`}</span>;
                }
              },
              {
                key: 'result',
                header: 'Kết quả',
                hideOnMobile: true,
                cell: (row) => (
                  <div>
                    <div>{(row as RelaySession).result || '—'}</div>
                    {(row as RelaySession).message && (
                      <div className="muted table-subline">
                        {(row as RelaySession).message}
                      </div>
                    )}
                  </div>
                )
              },
              {
                key: 'close',
                header: 'Lý do đóng',
                cell: (row) => {
                  const reason = (row as RelaySession).closeReason;
                  return <StatusBadge label={reason} kind={closeKind(reason)} />;
                }
              }
            ]}
          />
        )}

        {tab === 'events' && (
          <DataTable
            items={list.data?.items ?? []}
            rowKey={(row) => `e-${(row as RelayEvent).id}`}
            loading={list.isLoading}
            error={list.isError ? 'Không tải được lịch sử sự kiện.' : undefined}
            empty="Chưa có sự kiện relay."
            columns={[
              {
                key: 'job',
                header: 'Relay job',
                cell: (row) => <strong>{(row as RelayEvent).jobName}</strong>
              },
              {
                key: 'ts',
                header: 'Thời điểm',
                cell: (row) => <span className="mono">{formatLocal((row as RelayEvent).ts)}</span>
              },
              {
                key: 'type',
                header: 'Loại',
                cell: (row) => <StatusBadge label={(row as RelayEvent).type} />
              },
              {
                key: 'message',
                header: 'Nội dung',
                hideOnMobile: true,
                cell: (row) => (row as RelayEvent).message || '—'
              }
            ]}
          />
        )}

        {tab === 'hourly' && (
          <DataTable
            items={list.data?.items ?? []}
            rowKey={(row) => `h-${(row as RelayHourly).jobId}-${(row as RelayHourly).hourStartUtc}`}
            loading={list.isLoading}
            error={list.isError ? 'Không tải được thống kê giờ.' : undefined}
            empty="Chưa có thống kê giờ."
            columns={[
              {
                key: 'job',
                header: 'Relay job',
                cell: (row) => <strong>{(row as RelayHourly).jobName}</strong>
              },
              {
                key: 'hour',
                header: 'Giờ (+07)',
                cell: (row) => (
                  <span className="mono">{formatLocal((row as RelayHourly).hourStartUtc)}</span>
                )
              },
              {
                key: 'online',
                header: 'Online (s)',
                align: 'right',
                cell: (row) => (row as RelayHourly).onlineSec
              },
              {
                key: 'sessions',
                header: 'Phiên',
                align: 'right',
                hideOnMobile: true,
                cell: (row) => (row as RelayHourly).sessions
              },
              {
                key: 'errors',
                header: 'Lỗi',
                align: 'right',
                cell: (row) => (row as RelayHourly).errors
              },
              {
                key: 'retries',
                header: 'Retry',
                align: 'right',
                hideOnMobile: true,
                cell: (row) => (row as RelayHourly).retries
              }
            ]}
          />
        )}

        {tab === 'audit' && (
          <DataTable
            items={audit.data?.items ?? []}
            rowKey={(row) => `a-${row.id}`}
            loading={audit.isLoading}
            error={audit.isError ? 'Không tải được audit.' : undefined}
            empty="Chưa có bản ghi audit."
            columns={[
              {
                key: 'time',
                header: 'Thời điểm',
                cell: (row) => <span className="mono">{formatLocal(row.createdAt)}</span>
              },
              {
                key: 'actor',
                header: 'Người thực hiện',
                cell: (row) => <strong>{row.actorName || `#${row.actorId ?? '—'}`}</strong>
              },
              {
                key: 'action',
                header: 'Hành động',
                cell: (row) => <StatusBadge label={row.action} />
              },
              {
                key: 'entity',
                header: 'Đối tượng',
                hideOnMobile: true,
                cell: (row) => (
                  <span className="mono">
                    {row.entityType}
                    {row.entityId ? ` #${row.entityId}` : ''}
                  </span>
                )
              },
              {
                key: 'ip',
                header: 'IP',
                hideOnMobile: true,
                cell: (row) => <span className="mono">{row.ip || '—'}</span>
              }
            ]}
          />
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={tab === 'audit' ? audit.data?.total ?? 0 : list.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </section>
  );
}
