import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useListParams } from '../lib/useListParams';
import type {
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
  Select,
  StatusBadge,
  Tabs
} from '../components/ui';

type Row = RelaySession | RelayEvent | RelayHourly;

interface HistoryList {
  items: Row[];
  total: number;
}

interface RelayJobList {
  items: RelayJob[];
}

type TabValue = 'sessions' | 'events' | 'hourly';

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
  const [tab, setTab] = useState<TabValue>('sessions');
  const { page, pageSize, setPage, setPageSize, getParam, setParam } = useListParams();
  const jobId = getParam('jobId');
  const from = getParam('from');
  const to = getParam('to');

  const jobs = useQuery({
    queryKey: ['relay-jobs', 'history-options'],
    queryFn: () => apiFetch<RelayJobList>('/api/relay-jobs?pageSize=50')
  });

  const list = useQuery({
    queryKey: ['relay-history', tab, page, pageSize, jobId, from, to],
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

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <section className="page">
      <PageHeader
        title="Lịch sử relay"
        description="Phiên, sự kiện và thống kê giờ theo phạm vi quyền."
        actions={<HistoryIcon size={20} className="muted" aria-hidden="true" />}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sessions', label: 'Phiên' },
          { value: 'events', label: 'Sự kiện' },
          { value: 'hourly', label: 'Theo giờ' }
        ]}
      />

      <div className="panel">
        <div className="table-head history-filters">
          <Field label="Relay job">
            <Select value={jobId} onChange={(event) => setParam('jobId', event.target.value)}>
              <option value="">Tất cả</option>
              {jobs.data?.items.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </Select>
          </Field>
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
          <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
            Tải lại
          </Button>
        </div>

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
                  <span className="mono">{formatLocal((row as RelaySession).startTs)}</span>
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
                cell: (row) => (row as RelaySession).result || '—'
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
