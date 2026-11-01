import { Router } from 'express';
import { ApiError, asyncHandler, clientIp } from '../lib/http';
import {
  getSettings,
  listJobs,
  updateJob,
  updateSettings
} from '../lib/maintenanceConfig';
import {
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
    const [jobs, settings, last] = await Promise.all([
      listJobs(true),
      getSettings(true),
      lastRunMap()
    ]);
    const nextRunAt = nextDailyRun(settings);
    res.json({
      generatedAt: new Date().toISOString(),
      scheduler: {
        enabled: settings.schedulerEnabled,
        hourLocal: settings.hourLocal,
        minuteLocal: settings.minuteLocal,
        timezone: settings.timezone,
        updatedAt: settings.updatedAt
      },
      items: jobs.map((job) => ({
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
        lastRunAt: last.get(job.key)?.finishedAt ?? null,
        lastStatus: last.get(job.key)?.status ?? null,
        lastRowsDeleted: last.get(job.key)?.rowsDeleted ?? null,
        nextRunAt: job.enabled && job.scope === 'admin' ? nextRunAt : null
      }))
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
