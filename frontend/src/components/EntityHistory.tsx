import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon, RefreshCw } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import type { StationHistoryItem, StationHistoryResponse } from '../types';
import { Button, EmptyState, Pagination, Select, StatusBadge } from './ui';
import type { EntityTimelineKind } from './EntityTimeline';

type LevelFilter = 'all' | 'error' | 'warning' | 'info';
type HistoryRange = '24h' | '7d' | '30d';

interface HistoryResponse extends Omit<StationHistoryResponse, 'probeHistory'> {
  probeHistory?: StationHistoryResponse['probeHistory'];
}

const RANGES: Array<{ value: HistoryRange; label: string }> = [
  { value: '24h', label: '24 giờ' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' }
];

const LEVELS: Array<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: 'Tất cả hoạt động' },
  { value: 'error', label: 'Lỗi' },
  { value: 'warning', label: 'Cảnh báo' },
  { value: 'info', label: 'Thông tin' }
];

function formatLocal(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function sourceKind(source: string): 'ok' | 'warn' | 'error' | 'info' | 'neutral' {
  if (source === 'quality') return 'ok';
  if (source === 'caster') return 'info';
  if (source === 'relay') return 'warn';
  if (source === 'audit') return 'neutral';
  return 'neutral';
}

function levelKind(level: string): 'ok' | 'warn' | 'error' | 'info' | 'neutral' {
  if (level === 'critical' || level === 'error') return 'error';
  if (level === 'warning' || level === 'warn') return 'warn';
  if (level === 'info') return 'info';
  return 'neutral';
}

export function EntityHistoryPanel({ kind, id }: { kind: EntityTimelineKind; id: number }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [range, setRange] = useState<HistoryRange>('24h');
  const [level, setLevel] = useState<LevelFilter>('all');
  const from = useMemo(() => {
    const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);
  const history = useQuery({
    queryKey: ['entity-history', kind, id, from, page, pageSize, level],
    queryFn: () =>
      apiFetch<HistoryResponse>(
        `/api/${kind === 'station' ? 'stations' : 'relay-jobs'}/${id}/history?from=${encodeURIComponent(
          from
        )}&page=${page}&pageSize=${pageSize}${level === 'all' ? '' : `&level=${level}`}`
      )
  });
  const data = history.data;
  const sourceEntries = data
    ? (Object.entries(data.sources) as Array<[string, number]>).filter(([, count]) => count > 0)
    : [];
  const items: StationHistoryItem[] = data?.items ?? [];

  return (
    <>
      <div className="history-toolbar">
        <div className="history-range">
          {RANGES.map((value) => (
            <button
              type="button"
              key={value.value}
              className={`btn ghost small ${range === value.value ? 'active' : ''}`}
              onClick={() => {
                setRange(value.value);
                setPage(1);
              }}
            >
              {value.label}
            </button>
          ))}
        </div>
        <div className="history-filters">
          <label className="history-filter">
            <span className="muted">Loại</span>
            <Select
              aria-label="Lọc loại sự kiện"
              value={level}
              onChange={(event) => {
                setLevel(event.target.value as LevelFilter);
                setPage(1);
              }}
            >
              {LEVELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="ghost" onClick={() => history.refetch()} loading={history.isFetching}>
            <RefreshCw size={16} aria-hidden="true" /> Tải lại
          </Button>
        </div>
      </div>

      {sourceEntries.length > 0 && (
        <div className="source-summary">
          {sourceEntries.map(([source, count]) => (
            <StatusBadge key={source} label={`${source} ${count}`} kind={sourceKind(source)} />
          ))}
        </div>
      )}

      {history.isLoading ? (
        <div className="chart-empty">Đang tải lịch sử...</div>
      ) : history.isError ? (
        <EmptyState
          title="Không tải được lịch sử"
          description={
            history.error instanceof ApiClientError
              ? history.error.message
              : 'Kiểm tra kết nối DB runtime.'
          }
          action={<Button onClick={() => history.refetch()}>Thử lại</Button>}
        />
      ) : items.length === 0 ? (
        <div className="table-state">Chưa có sự kiện trong khoảng thời gian này.</div>
      ) : (
        <div className="timeline">
          {items.map((event) => (
            <article className="timeline-item" key={event.id}>
              <div className={`timeline-dot ${event.source}`} />
              <div className="timeline-content">
                <div className="timeline-head">
                  <strong>{event.title}</strong>
                  <div className="timeline-badges">
                    <StatusBadge label={event.source} kind={sourceKind(event.source)} />
                    <StatusBadge label={event.level} kind={levelKind(event.level)} />
                  </div>
                </div>
                <p className="muted">{event.detail}</p>
                <span className="mono muted">{formatLocal(event.at)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          pageSizeOptions={[50, 100]}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
      <div className="probe-note">
        <HistoryIcon size={14} aria-hidden="true" />{' '}
        {data?.probeHistory?.message ??
          'Log gần nhất được phân trang 100 dòng; bộ lọc áp dụng trước khi phân trang.'}
      </div>
    </>
  );
}
