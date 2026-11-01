import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, RefreshCw, Timer, Zap } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ToastProvider';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  type Column
} from '../../components/ui';

interface SchedulerInfo {
  enabled: boolean;
  hourLocal: number;
  minuteLocal: number;
  timezone: string;
  updatedAt: string | null;
}

interface JobItem {
  key: string;
  label: string;
  scope: 'admin' | 'runtime';
  table: string;
  retentionDays: number;
  batchSize: number;
  intervalSec: number;
  enabled: boolean;
  updatedAt: string | null;
  configSource: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastRowsDeleted: number | null;
  nextRunAt: string | null;
}

interface JobsResponse {
  generatedAt: string;
  scheduler: SchedulerInfo;
  items: JobItem[];
}

interface RunItem {
  id: number;
  jobKey: string;
  scope: string;
  table: string;
  dryRun: boolean;
  status: 'running' | 'ok' | 'error';
  rowsDeleted: number;
  durationMs: number;
  error: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface RunsResponse {
  items: RunItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface JobForm {
  retentionDays: string;
  batchSize: string;
  intervalSec: string;
  enabled: boolean;
}

interface SchedulerForm {
  enabled: boolean;
  hour: string;
  minute: string;
  updatedAt: string | null;
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

function formatDuration(value: number): string {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function intervalLabel(seconds: number): string {
  if (seconds >= 86400) return `${Math.round(seconds / 86400)} ngày`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} giờ`;
  return `${Math.round(seconds / 60)} phút`;
}

function statusKind(status: string | null): 'ok' | 'warn' | 'error' | 'neutral' {
  if (status === 'ok') return 'ok';
  if (status === 'running') return 'warn';
  if (status === 'error') return 'error';
  return 'neutral';
}

export function AutomationTab() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can('system_ops', 'edit');
  const canView = can('system_ops', 'view');

  const [editJob, setEditJob] = useState<JobItem | null>(null);
  const [jobForm, setJobForm] = useState<JobForm>({
    retentionDays: '',
    batchSize: '',
    intervalSec: '',
    enabled: true
  });
  const [savingJob, setSavingJob] = useState(false);
  const [runTarget, setRunTarget] = useState<JobItem | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [schedulerForm, setSchedulerForm] = useState<SchedulerForm>({
    enabled: true,
    hour: '3',
    minute: '0',
    updatedAt: null
  });
  const [savingScheduler, setSavingScheduler] = useState(false);
  const [runPage, setRunPage] = useState(1);
  const [runPageSize, setRunPageSize] = useState(10);
  const [runJobKey, setRunJobKey] = useState('');

  const jobsQuery = useQuery({
    queryKey: ['maintenance-jobs'],
    queryFn: () => apiFetch<JobsResponse>('/api/system/maintenance/jobs'),
    refetchInterval: 30_000,
    enabled: canView
  });

  const runsQuery = useQuery({
    queryKey: ['maintenance-runs', runPage, runPageSize, runJobKey],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(runPage),
        pageSize: String(runPageSize)
      });
      if (runJobKey) params.set('jobKey', runJobKey);
      return apiFetch<RunsResponse>(`/api/system/maintenance/runs?${params.toString()}`);
    },
    enabled: canView
  });

  const jobs = jobsQuery.data?.items ?? [];
  const scheduler = jobsQuery.data?.scheduler;

  function openEdit(job: JobItem) {
    setEditJob(job);
    setJobForm({
      retentionDays: String(job.retentionDays),
      batchSize: String(job.batchSize),
      intervalSec: String(job.intervalSec),
      enabled: job.enabled
    });
  }

  async function saveJob() {
    if (!editJob) return;
    setSavingJob(true);
    try {
      await apiFetch(`/api/system/maintenance/jobs/${encodeURIComponent(editJob.key)}`, {
        method: 'PUT',
        csrfToken,
        body: {
          retentionDays: Number(jobForm.retentionDays),
          batchSize: Number(jobForm.batchSize),
          intervalSec: Number(jobForm.intervalSec),
          enabled: jobForm.enabled,
          expectedUpdatedAt: editJob.updatedAt
        }
      });
      push('Đã lưu cấu hình job', 'success');
      setEditJob(null);
      await queryClient.invalidateQueries({ queryKey: ['maintenance-jobs'] });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Lưu cấu hình thất bại', 'error');
    } finally {
      setSavingJob(false);
    }
  }

  async function executeRun(job: JobItem, dryRun: boolean) {
    setRunningKey(job.key);
    try {
      const result = await apiFetch<{ rowsDeleted: number }>('/api/system/maintenance/run', {
        method: 'POST',
        csrfToken,
        body: { jobKey: job.key, dryRun }
      });
      push(
        dryRun
          ? `Chạy thử ${job.label}: ${result.rowsDeleted} dòng sẽ bị xóa`
          : `Đã dọn ${job.label}: ${result.rowsDeleted} dòng`,
        'success'
      );
      await queryClient.invalidateQueries({ queryKey: ['maintenance-jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['maintenance-runs'] });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Chạy job thất bại', 'error');
    } finally {
      setRunningKey(null);
    }
  }

  function openScheduler() {
    if (!scheduler) return;
    setSchedulerForm({
      enabled: scheduler.enabled,
      hour: String(scheduler.hourLocal),
      minute: String(scheduler.minuteLocal),
      updatedAt: scheduler.updatedAt
    });
    setSchedulerOpen(true);
  }

  async function saveScheduler() {
    if (!schedulerForm) return;
    setSavingScheduler(true);
    try {
      await apiFetch('/api/system/maintenance/settings', {
        method: 'PUT',
        csrfToken,
        body: {
          schedulerEnabled: schedulerForm.enabled,
          hourLocal: Number(schedulerForm.hour),
          minuteLocal: Number(schedulerForm.minute),
          expectedUpdatedAt: schedulerForm.updatedAt
        }
      });
      push('Đã lưu lịch chạy', 'success');
      setSchedulerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['maintenance-jobs'] });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Lưu lịch chạy thất bại', 'error');
    } finally {
      setSavingScheduler(false);
    }
  }

  const jobColumns: Column<JobItem>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: (job) => (
        <div>
          <strong>{job.label}</strong>
          <div className="muted mono">{job.key}</div>
        </div>
      )
    },
    {
      key: 'scope',
      header: 'Phạm vi',
      cell: (job) => (
        <StatusBadge label={job.scope} kind={job.scope === 'runtime' ? 'info' : 'neutral'} />
      )
    },
    {
      key: 'table',
      header: 'Bảng',
      hideOnMobile: true,
      cell: (job) => <span className="mono">{job.table}</span>
    },
    {
      key: 'retention',
      header: 'Ngưỡng',
      cell: (job) => (
        <div className="mono">
          {job.retentionDays} ngày
          <div className="muted">batch {job.batchSize}</div>
        </div>
      )
    },
    {
      key: 'interval',
      header: 'Chu kỳ',
      hideOnMobile: true,
      cell: (job) => <span className="mono">{intervalLabel(job.intervalSec)}</span>
    },
    {
      key: 'enabled',
      header: 'Bật',
      cell: (job) => (
        <StatusBadge label={job.enabled ? 'on' : 'off'} kind={job.enabled ? 'ok' : 'neutral'} />
      )
    },
    {
      key: 'last',
      header: 'Lần chạy cuối',
      cell: (job) => (
        <div>
          <div className="mono">{formatLocal(job.lastRunAt)}</div>
          <div className="muted">
            {job.lastStatus ? `${job.lastStatus} · ${job.lastRowsDeleted ?? 0} dòng` : 'chưa chạy'}
          </div>
        </div>
      )
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      cell: (job) => (
        <div className="row-actions">
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => openEdit(job)}>
            <Pencil size={14} aria-hidden="true" /> Sửa
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canEdit || runningKey === job.key}
            onClick={() => void executeRun(job, true)}
          >
            <Zap size={14} aria-hidden="true" /> Chạy thử
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!canEdit || runningKey === job.key}
            onClick={() => setRunTarget(job)}
          >
            <Play size={14} aria-hidden="true" /> Chạy ngay
          </Button>
        </div>
      )
    }
  ];

  const runColumns: Column<RunItem>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: (run) => (
        <div>
          <strong>{run.jobKey}</strong>
          <div className="muted mono">{run.table}</div>
        </div>
      )
    },
    {
      key: 'dryRun',
      header: 'Kiểu',
      cell: (run) => (
        <StatusBadge label={run.dryRun ? 'dry-run' : 'thật'} kind={run.dryRun ? 'info' : 'neutral'} />
      )
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (run) => <StatusBadge label={run.status} kind={statusKind(run.status)} />
    },
    {
      key: 'rows',
      header: 'Số dòng',
      align: 'right',
      cell: (run) => <span className="mono">{run.rowsDeleted}</span>
    },
    {
      key: 'duration',
      header: 'Thời gian',
      align: 'right',
      hideOnMobile: true,
      cell: (run) => <span className="mono">{formatDuration(run.durationMs)}</span>
    },
    {
      key: 'started',
      header: 'Bắt đầu',
      hideOnMobile: true,
      cell: (run) => <span className="mono">{formatLocal(run.startedAt)}</span>
    },
    {
      key: 'error',
      header: 'Lỗi',
      hideOnMobile: true,
      cell: (run) => <span className="muted">{run.error || '—'}</span>
    }
  ];

  if (!canView) {
    return (
      <>
        <PageHeader title="Tự động hóa" description="Chỉ super admin được xem và điều khiển bảo trì." />
        <div className="panel table-state error">Bạn không có quyền truy cập trang này.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Tự động hóa"
        description="Cấu hình dọn dẹp lưu trong database; job runtime do Go áp dụng, job admin do Node chạy."
        actions={
          <>
            <Button variant="ghost" onClick={() => jobsQuery.refetch()} loading={jobsQuery.isFetching}>
              <RefreshCw size={16} aria-hidden="true" /> Tải lại
            </Button>
            <Button variant="ghost" onClick={openScheduler} disabled={!canEdit || !scheduler}>
              <Timer size={16} aria-hidden="true" /> Sửa lịch
            </Button>
          </>
        }
      />

      <div className="panel inline-alert">
        Ngưỡng đọc từ bảng <span className="mono">maintenance_jobs</span>. Job runtime do Go chạy
        theo chu kỳ; scheduler Node chỉ chạy job admin.
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Lịch chạy</h2>
          <StatusBadge
            label={scheduler?.enabled ? 'đang bật' : 'đang tắt'}
            kind={scheduler?.enabled ? 'ok' : 'neutral'}
          />
        </header>
        {jobsQuery.isLoading ? (
          <div className="table-state">Đang tải lịch chạy...</div>
        ) : jobsQuery.isError || !scheduler ? (
          <div className="table-state error">Không tải được lịch chạy.</div>
        ) : (
          <dl className="health-facts">
            <div><dt>Giờ chạy</dt><dd className="mono">{String(scheduler.hourLocal).padStart(2, '0')}:{String(scheduler.minuteLocal).padStart(2, '0')}</dd></div>
            <div><dt>Múi giờ</dt><dd className="mono">{scheduler.timezone}</dd></div>
            <div><dt>Cập nhật</dt><dd>{formatLocal(scheduler.updatedAt)}</dd></div>
            <div><dt>Tổng job</dt><dd className="mono">{jobs.length}</dd></div>
          </dl>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Job dọn dẹp</h2>
        </header>
        <DataTable
          columns={jobColumns}
          items={jobs}
          rowKey={(job) => job.key}
          loading={jobsQuery.isLoading}
          error={jobsQuery.isError ? 'Không tải được danh sách job.' : undefined}
          empty="Chưa có cấu hình job."
          showIndex={false}
        />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Lịch sử chạy</h2>
        </header>
        <div className="table-toolbar">
          <label className="field inline-field">
            <span className="field-label">Job</span>
            <Select
              value={runJobKey}
              onChange={(event) => {
                setRunJobKey(event.target.value);
                setRunPage(1);
              }}
              aria-label="Lọc theo job"
            >
              <option value="">Tất cả job</option>
              {jobs.map((job) => (
                <option key={job.key} value={job.key}>
                  {job.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <DataTable
          columns={runColumns}
          items={runsQuery.data?.items ?? []}
          rowKey={(run) => run.id}
          loading={runsQuery.isLoading}
          error={runsQuery.isError ? 'Không tải được lịch sử chạy.' : undefined}
          empty="Chưa có lần chạy nào."
          showIndex={false}
        />
        <Pagination
          page={runsQuery.data?.page ?? runPage}
          pageSize={runsQuery.data?.pageSize ?? runPageSize}
          total={runsQuery.data?.total ?? 0}
          onPageChange={setRunPage}
          onPageSizeChange={(size) => {
            setRunPageSize(size);
            setRunPage(1);
          }}
        />
      </section>

      <Modal
        open={editJob !== null}
        onOpenChange={(open) => {
          if (!open) setEditJob(null);
        }}
        title="Sửa cấu hình job"
        description={editJob ? `${editJob.label} · ${editJob.table}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditJob(null)}>
              Hủy
            </Button>
            <Button variant="primary" loading={savingJob} onClick={() => void saveJob()}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Ngưỡng (ngày)" hint="1–3650">
            <Input
              type="number"
              min={1}
              max={3650}
              value={jobForm.retentionDays}
              onChange={(event) => setJobForm({ ...jobForm, retentionDays: event.target.value })}
            />
          </Field>
          <Field label="Batch size" hint="100–50000">
            <Input
              type="number"
              min={100}
              max={50000}
              value={jobForm.batchSize}
              onChange={(event) => setJobForm({ ...jobForm, batchSize: event.target.value })}
            />
          </Field>
          <Field label="Chu kỳ (giây)" hint="300–86400">
            <Input
              type="number"
              min={300}
              max={86400}
              value={jobForm.intervalSec}
              onChange={(event) => setJobForm({ ...jobForm, intervalSec: event.target.value })}
            />
          </Field>
          <Field label="Bật job">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={jobForm.enabled}
                onChange={(event) => setJobForm({ ...jobForm, enabled: event.target.checked })}
              />
              <span>Cho phép chạy tự động</span>
            </label>
          </Field>
        </div>
      </Modal>

      <Modal
        open={schedulerOpen}
        onOpenChange={setSchedulerOpen}
        title="Sửa lịch chạy"
        description="Scheduler Node chạy job admin một lần mỗi ngày."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedulerOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" loading={savingScheduler} onClick={() => void saveScheduler()}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Bật scheduler">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={schedulerForm.enabled}
                onChange={(event) =>
                  setSchedulerForm({ ...schedulerForm, enabled: event.target.checked })
                }
              />
              <span>Chạy tự động hằng ngày</span>
            </label>
          </Field>
          <Field label="Giờ" hint="0–23">
            <Input
              type="number"
              min={0}
              max={23}
              value={schedulerForm.hour}
              onChange={(event) => setSchedulerForm({ ...schedulerForm, hour: event.target.value })}
            />
          </Field>
          <Field label="Phút" hint="0–59">
            <Input
              type="number"
              min={0}
              max={59}
              value={schedulerForm.minute}
              onChange={(event) => setSchedulerForm({ ...schedulerForm, minute: event.target.value })}
            />
          </Field>
          <Field label="Múi giờ">
            <Input value="Asia/Ho_Chi_Minh" readOnly />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={runTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRunTarget(null);
        }}
        title="Chạy dọn dẹp thật"
        description={
          runTarget
            ? `Xóa dữ liệu cũ hơn ${runTarget.retentionDays} ngày của ${runTarget.label} (${runTarget.table}). Hành động không thể hoàn tác.`
            : ''
        }
        confirmLabel="Chạy ngay"
        pending={runningKey !== null}
        onConfirm={() => {
          if (!runTarget) return;
          void executeRun(runTarget, false);
          setRunTarget(null);
        }}
      />
    </>
  );
}
