import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { Button, PageHeader, StatusBadge } from '../../components/ui';

interface TableSize {
  name: string;
  rows: number;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
}

interface RetentionJob {
  key: string;
  label: string;
  scope: 'admin' | 'runtime';
  table: string;
  retentionDays: number;
  enabled: boolean;
  backlogRows: number | null;
}

interface Recommendation {
  id: string;
  level: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  actionTab: 'optimize' | 'automation' | null;
}

interface OptimizeResponse {
  generatedAt: string;
  cacheTtlSec: number;
  cached: boolean;
  database: {
    status: 'ok' | 'error';
    admin: { sizeBytes: number; tables: TableSize[] };
    runtime: { sizeBytes: number; tables: TableSize[] };
    pool: {
      totalConnections: number | null;
      freeConnections: number | null;
      queue: number | null;
      connectionLimit: number | null;
    } | null;
    latencyMs: number | null;
    slowQueries:
      | { available: true; items: { digestText: string; calls: number; totalSeconds: number }[] }
      | { available: false; reason: string };
  };
  go: {
    reachable: boolean;
    latencyMs: number;
    quality: Record<string, unknown> | null;
    relay: { jobId: number; state: string; monitorDrops: number; crcErrors: number; retries: number }[];
  };
  node: { heapPercent: number; eventLoopLagMs: number; rssBytes: number; socketClients: number };
  disk:
    | {
        available: true;
        totalBytes: number;
        freeBytes: number;
        usedPercent: number;
        growthBytesPerDay: number | null;
        projectedFullDays: number | null;
      }
    | { available: false; reason: string };
  retention: { jobs: RetentionJob[] };
  recommendations: Recommendation[];
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('vi-VN').format(value);
}

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

function levelKind(level: Recommendation['level']): 'warn' | 'error' | 'info' {
  if (level === 'critical') return 'error';
  if (level === 'warn') return 'warn';
  return 'info';
}

function levelIcon(level: Recommendation['level']) {
  if (level === 'critical') return <ShieldAlert size={18} aria-hidden="true" />;
  if (level === 'warn') return <AlertTriangle size={18} aria-hidden="true" />;
  return <Info size={18} aria-hidden="true" />;
}

function qualityValue(quality: Record<string, unknown> | null, key: string): number | null {
  if (!quality) return null;
  const value = quality[key];
  return typeof value === 'number' ? value : null;
}

export function OptimizeTab() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['system-optimize'],
    queryFn: () => apiFetch<OptimizeResponse>('/api/system/optimize'),
    refetchInterval: 30_000
  });
  const data = query.data;
  const backlog = data
    ? data.retention.jobs
        .filter((job) => job.backlogRows !== null)
        .sort((a, b) => (b.backlogRows ?? 0) - (a.backlogRows ?? 0))
        .slice(0, 6)
    : [];
  const allTables = data ? [...data.database.admin.tables, ...data.database.runtime.tables] : [];
  const topTables = [...allTables].sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 8);

  function openAutomation() {
    const next = new URLSearchParams(params);
    next.set('tab', 'automation');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Tối ưu chỉ số"
        description="Dung lượng dữ liệu, hàng đợi Go, tài nguyên Node và gợi ý xử lý. Chỉ đọc, không tự sửa tham số."
        actions={
          <Button variant="ghost" onClick={() => query.refetch()} loading={query.isFetching}>
            <RefreshCw size={16} aria-hidden="true" /> Tải lại
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="panel table-state">Đang thu thập số liệu tối ưu...</div>
      ) : query.isError || !data ? (
        <div className="panel table-state error">Không tải được số liệu tối ưu.</div>
      ) : (
        <>
          <div className="health-banner">
            <div>
              <span className="muted">Trạng thái dữ liệu</span>
              <div className="health-overall">
                <StatusBadge
                  label={data.database.status === 'ok' ? 'database ok' : 'database lỗi'}
                  kind={data.database.status === 'ok' ? 'ok' : 'error'}
                />
                <StatusBadge
                  label={data.cached ? 'cached' : 'fresh'}
                  kind="info"
                />
                <strong>{data.recommendations.length} gợi ý</strong>
              </div>
            </div>
            <div className="muted">
              Cập nhật {formatLocal(data.generatedAt)} · cache {data.cacheTtlSec}s · tự làm mới 30s
            </div>
          </div>

          <section className="panel">
            <header className="panel-head">
              <h2>Gợi ý tối ưu</h2>
            </header>
            {data.recommendations.length === 0 ? (
              <div className="table-state">Không có gợi ý; các chỉ số đang trong ngưỡng bình thường.</div>
            ) : (
              <ul className="recommendation-list">
                {data.recommendations.map((item) => (
                  <li key={item.id} className={`recommendation ${item.level}`}>
                    <span className="recommendation-icon">{levelIcon(item.level)}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted">{item.detail}</p>
                    </div>
                    <div className="recommendation-actions">
                      <StatusBadge label={item.level} kind={levelKind(item.level)} />
                      {item.actionTab === 'automation' ? (
                        <Button size="sm" variant="ghost" onClick={openAutomation}>
                          Mở tự động hóa
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="health-grid">
            <article className="health-card">
              <header>
                <h2>Database</h2>
                <StatusBadge
                  label={data.database.status}
                  kind={data.database.status === 'ok' ? 'ok' : 'error'}
                />
              </header>
              <dl className="health-facts">
                <div><dt>Admin</dt><dd className="mono">{formatBytes(data.database.admin.sizeBytes)}</dd></div>
                <div><dt>Runtime</dt><dd className="mono">{formatBytes(data.database.runtime.sizeBytes)}</dd></div>
                <div><dt>Ping</dt><dd className="mono">{data.database.latencyMs === null ? '—' : `${data.database.latencyMs.toFixed(1)} ms`}</dd></div>
                <div><dt>Pool</dt><dd className="mono">{data.database.pool?.totalConnections ?? '—'} / {data.database.pool?.connectionLimit ?? '—'}</dd></div>
                <div><dt>Hàng đợi</dt><dd className="mono">{data.database.pool?.queue ?? '—'}</dd></div>
              </dl>
              <p className="health-note">Dung lượng lấy từ information_schema, làm tròn theo InnoDB.</p>
            </article>

            <article className="health-card">
              <header>
                <h2>Tồn đọng retention</h2>
                <StatusBadge label={`${backlog.length} job`} kind={backlog.length > 0 ? 'warn' : 'ok'} />
              </header>
              {backlog.length === 0 ? (
                <div className="table-state">Không có tồn đọng đáng kể.</div>
              ) : (
                <ul className="optimize-list">
                  {backlog.map((job) => (
                    <li key={job.key}>
                      <div>
                        <strong>{job.label}</strong>
                        <span className="muted mono"> · {job.table}</span>
                      </div>
                      <span className="mono">{formatNumber(job.backlogRows)} dòng · {job.retentionDays}d</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="health-note">Số dòng cũ hơn ngưỡng; bấm “Mở tự động hóa” để chạy thử.</p>
            </article>

            <article className="health-card">
              <header>
                <h2>Go runtime</h2>
                <StatusBadge label={data.go.reachable ? 'reachable' : 'unreachable'} kind={data.go.reachable ? 'ok' : 'error'} />
              </header>
              <dl className="health-facts">
                <div><dt>Latency</dt><dd className="mono">{data.go.latencyMs.toFixed(1)} ms</dd></div>
                <div><dt>Quality queue</dt><dd className="mono">{qualityValue(data.go.quality, 'queueDepth') ?? '—'} / {qualityValue(data.go.quality, 'queueSize') ?? '—'}</dd></div>
                <div><dt>Dropped</dt><dd className="mono">{qualityValue(data.go.quality, 'dropped') ?? '—'}</dd></div>
                <div><dt>Parse errors</dt><dd className="mono">{qualityValue(data.go.quality, 'parseErrors') ?? '—'}</dd></div>
                <div><dt>Store drops</dt><dd className="mono">{qualityValue(data.go.quality, 'storeDrops') ?? '—'}</dd></div>
                <div><dt>Targets</dt><dd className="mono">{qualityValue(data.go.quality, 'targets') ?? '—'}</dd></div>
                <div><dt>Relay job</dt><dd className="mono">{data.go.relay.length}</dd></div>
              </dl>
              <p className="health-note">Không nằm trên đường byte RTCM; số liệu từ RAM của Go.</p>
            </article>

            <article className="health-card">
              <header>
                <h2>Node &amp; đĩa</h2>
                <StatusBadge
                  label={data.disk.available ? `${data.disk.usedPercent.toFixed(0)}%` : 'unknown'}
                  kind={data.disk.available && data.disk.usedPercent >= 90 ? 'error' : 'ok'}
                />
              </header>
              <dl className="health-facts">
                <div><dt>Heap</dt><dd className="mono">{data.node.heapPercent.toFixed(1)}%</dd></div>
                <div><dt>Event-loop</dt><dd className="mono">{data.node.eventLoopLagMs.toFixed(1)} ms</dd></div>
                <div><dt>RSS</dt><dd className="mono">{formatBytes(data.node.rssBytes)}</dd></div>
                <div><dt>Socket clients</dt><dd className="mono">{data.node.socketClients}</dd></div>
                <div>
                  <dt>Đĩa</dt>
                  <dd className="mono">
                    {data.disk.available
                      ? `${formatBytes(data.disk.freeBytes)} trống / ${data.disk.usedPercent.toFixed(1)}%`
                      : data.disk.reason}
                  </dd>
                </div>
              </dl>
              <p className="health-note">Chưa đủ dữ liệu lịch sử để dự báo ngày đầy đĩa.</p>
            </article>
          </div>

          <section className="panel">
            <header className="panel-head">
              <h2>Bảng lớn nhất</h2>
            </header>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bảng</th>
                    <th className="align-right">Dòng</th>
                    <th className="align-right">Dung lượng</th>
                  </tr>
                </thead>
                <tbody>
                  {topTables.length === 0 ? (
                    <tr>
                      <td colSpan={3}>
                        <div className="table-state">Không đọc được thông tin bảng.</div>
                      </td>
                    </tr>
                  ) : (
                    topTables.map((table) => (
                      <tr key={table.name}>
                        <td className="mono">{table.name}</td>
                        <td className="align-right mono">{formatNumber(table.rows)}</td>
                        <td className="align-right mono">{formatBytes(table.totalBytes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Slow query</h2>
              <StatusBadge
                label={data.database.slowQueries.available ? 'available' : 'unavailable'}
                kind={data.database.slowQueries.available ? 'ok' : 'neutral'}
              />
            </header>
            {!data.database.slowQueries.available ? (
              <div className="table-state">{data.database.slowQueries.reason}</div>
            ) : data.database.slowQueries.items.length === 0 ? (
              <div className="table-state">Chưa có dữ liệu digest.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Câu lệnh</th>
                      <th className="align-right">Lần gọi</th>
                      <th className="align-right">Tổng giây</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.database.slowQueries.items.map((item, index) => (
                      <tr key={`${index}-${item.digestText}`}>
                        <td className="mono optimize-digest">{item.digestText}</td>
                        <td className="align-right mono">{formatNumber(item.calls)}</td>
                        <td className="align-right mono">{item.totalSeconds.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
