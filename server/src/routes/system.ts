import { Router } from 'express';
import { ApiError, asyncHandler, clientIp } from '../lib/http';
import {
  getSettings,
  listJobs,
  updateJob,
  updateSettings
} from '../lib/maintenanceConfig';
import {
  goMaintenanceStatus,
  lastRunMap,
  listRuns,
  nextDailyRun,
  reconcileGoMaintenance,
  runJob
} from '../lib/maintenance';
import { getSystemHealth } from '../lib/systemHealth';
import { getSystemOptimize } from '../lib/systemOptimize';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';

export const systemRouter = Router();
systemRouter.use(requireAuth);
systemRouter.use(csrfProtection);

systemRouter.get(
  '/health',
  requirePermission('system_health', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(await getSystemHealth());
  })
);

systemRouter.get(
  '/optimize',
  requirePermission('system_ops', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(await getSystemOptimize());
  })
);

systemRouter.get(
  '/maintenance/jobs',
  requirePermission('system_ops', 'view'),
  asyncHandler(async (_req, res) => {
    const [jobs, settings, last, goJobs] = await Promise.all([
      listJobs(true),
      getSettings(true),
      lastRunMap(),
      goMaintenanceStatus()
    ]);
    const nextRunAt = nextDailyRun(settings);
    const goMap = new Map((goJobs ?? []).map((job) => [job.key, job]));
    res.json({
      generatedAt: new Date().toISOString(),
      scheduler: {
        enabled: settings.schedulerEnabled,
        hourLocal: settings.hourLocal,
        minuteLocal: settings.minuteLocal,
        timezone: settings.timezone,
        updatedAt: settings.updatedAt
      },
      items: jobs.map((job) => {
        const goJob = goMap.get(job.key);
        const manual = last.get(job.key);
        return {
          key: job.key,
          label: job.label,
          scope: job.scope,
          table: job.table,
          retentionDays: job.retentionDays,
          batchSize: job.batchSize,
          intervalSec: job.intervalSec,
          enabled: job.enabled,
          updatedAt: job.updatedAt,
          configSource: 'database',
          running: goJob?.running ?? false,
          lastRunAt: goJob?.lastRunAt ?? manual?.finishedAt ?? null,
          lastStatus: goJob ? (goJob.lastError ? 'error' : goJob.lastRunAt ? 'ok' : null) : manual?.status ?? null,
          lastRowsDeleted: goJob ? goJob.lastRows : manual?.rowsDeleted ?? null,
          nextRunAt: job.enabled && job.scope === 'admin' ? nextRunAt : null
        };
      })
    });
  })
);

systemRouter.put(
  '/maintenance/jobs/:key',
  requirePermission('system_ops', 'edit'),
  asyncHandler(async (req, res) => {
    const updated = await updateJob(
      String(req.params.key),
      req.body ?? {},
      req.auth!.id,
      clientIp(req)
    );
    if (updated.scope === 'runtime') await reconcileGoMaintenance();
    res.json(updated);
  })
);

systemRouter.get(
  '/maintenance/settings',
  requirePermission('system_ops', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(await getSettings(true));
  })
);

systemRouter.put(
  '/maintenance/settings',
  requirePermission('system_ops', 'edit'),
  asyncHandler(async (req, res) => {
    res.json(await updateSettings(req.body ?? {}, req.auth!.id, clientIp(req)));
  })
);

systemRouter.get(
  '/maintenance/runs',
  requirePermission('system_ops', 'view'),
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 10);
    const jobKey = req.query.jobKey ? String(req.query.jobKey) : undefined;
    res.json(await listRuns(page, pageSize, jobKey));
  })
);

systemRouter.post(
  '/maintenance/run',
  requirePermission('system_ops', 'edit'),
  asyncHandler(async (req, res) => {
    const jobKey = String(req.body?.jobKey ?? '');
    if (!jobKey) throw new ApiError(400, 'VALIDATION', 'jobKey là bắt buộc');
    const dryRun = req.body?.dryRun === undefined ? true : Boolean(req.body.dryRun);
    res.json(await runJob(jobKey, dryRun, req.auth!.id, clientIp(req)));
  })
);
