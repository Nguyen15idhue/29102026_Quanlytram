import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { query as adminQuery } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { buildAlertImpacts } from '../lib/alertImpact';
import { asyncHandler } from '../lib/http';
import { severityForLevel } from '../lib/quality';
import { getSystemHealth } from '../lib/systemHealth';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { permissionsForRole } from '../rbac/permissions';
import { inScope, subtreeIds, tenantIds } from '../rbac/scope';
import { loadBaseData, loadOpenAlerts } from '../realtime/data';
import { buildSnapshot, permissionMap, scopeOf } from '../realtime/filter';

export const opsRouter = Router();
opsRouter.use(requireAuth);
opsRouter.use(csrfProtection);

function qualityWhere(stationIds: number[], relayIds: number[]): { sql: string; params: number[] } {
  const clauses: string[] = [];
  const params: number[] = [];
  if (stationIds.length > 0) {
    clauses.push(`(target_type = 'station' AND target_id IN (${stationIds.map(() => '?').join(',')}))`);
    params.push(...stationIds);
  }
  if (relayIds.length > 0) {
    clauses.push(`(target_type = 'relay_job' AND target_id IN (${relayIds.map(() => '?').join(',')}))`);
    params.push(...relayIds);
  }
  return {
    sql: clauses.length > 0 ? `(${clauses.join(' OR ')})` : '1=0',
    params
  };
}

function todayRange(): { start: Date; end: Date } {
  const offsetMs = 7 * 3600_000;
  const local = new Date(Date.now() + offsetMs);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocal - offsetMs);
  return { start, end: new Date(start.getTime() + 24 * 3600_000) };
}

opsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const [ids, tenants, permissions, raw, openAlerts] = await Promise.all([
      subtreeIds(auth.id),
      tenantIds(auth.id),
      permissionsForRole(auth.roleId),
      loadBaseData(),
      loadOpenAlerts()
    ]);
    const perms = permissionMap(permissions);
    const idsFor = (scope: string): number[] => (scope === 'tenant' ? tenants : ids);
    const snapshot = buildSnapshot(raw, openAlerts, perms, auth.id, ids, tenants);

    const mountScope = scopeOf(perms, 'mountpoints.view');
    const mountpoints = raw.mountpoints.filter((item) =>
      inScope(mountScope, auth.id, idsFor(mountScope), item.ownerId)
    ).length;
    const onlineAccounts = new Set(
      snapshot.connections
        .map((item) => item.accountId)
        .filter((id): id is number => id !== null && id !== undefined)
        .map(Number)
    ).size;

    const qualityScope = scopeOf(perms, 'quality.view');
    let qualityRows: RowDataPacket[] = [];
    let qualityOpen = 0;
    const incidentsToday = { total: 0, critical: 0, warning: 0 };
    const day = todayRange();
    const alertScope = scopeOf(perms, 'alerts.view');
    if (alertScope !== 'none') {
      const alertRows = await adminQuery<RowDataPacket[]>(
        `SELECT severity, owner_web_user_id FROM alerts
          WHERE created_at >= ? AND created_at < ? AND severity <> 'info'`,
        [day.start, day.end]
      );
      const alertIds = idsFor(alertScope);
      for (const row of alertRows) {
        if (!inScope(alertScope, auth.id, alertIds, row.owner_web_user_id)) continue;
        incidentsToday.total += 1;
        if (String(row.severity) === 'critical') incidentsToday.critical += 1;
        else incidentsToday.warning += 1;
      }
    }
    if (qualityScope !== 'none') {
      const qualityIds = idsFor(qualityScope);
      const stationIds = raw.stations
        .filter((item) => inScope(qualityScope, auth.id, qualityIds, item.ownerId))
        .map((item) => item.id);
      const relayIds = raw.jobs
        .filter((item) => inScope(qualityScope, auth.id, qualityIds, item.ownerId))
        .map((item) => item.id);
      const where = qualityWhere(stationIds, relayIds);
      let qualityTodayRows: RowDataPacket[] = [];
      [qualityRows, [{ count: qualityOpen }], qualityTodayRows] = await Promise.all([
        runtimeQuery<RowDataPacket[]>(
          `SELECT id, target_type, target_id, mountpoint_id, event_type, code, level,
                  first_seen, last_seen
             FROM quality_alerts
            WHERE resolved_at IS NULL AND ${where.sql}
            ORDER BY FIELD(level, 'critical', 'major', 'minor', 'info'), last_seen DESC
            LIMIT 200`,
          where.params
        ),
        runtimeQuery<RowDataPacket[]>(
          `SELECT COUNT(*) AS count FROM quality_alerts
            WHERE resolved_at IS NULL AND ${where.sql}`,
          where.params
        ),
        runtimeQuery<RowDataPacket[]>(
          `SELECT id, level FROM quality_alerts
            WHERE first_seen >= ? AND first_seen < ? AND level <> 'info' AND ${where.sql}`,
          [day.start, day.end, ...where.params]
        )
      ]);
      for (const row of qualityTodayRows) {
        incidentsToday.total += 1;
        if (String(row.level) === 'critical') incidentsToday.critical += 1;
        else incidentsToday.warning += 1;
      }
    }

    const incidents: any[] = snapshot.alerts.map((alert) => ({
      source: 'admin',
      id: alert.id,
      severity: alert.severity,
      level: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'major' : 'info',
      targetType: alert.targetType,
      targetId: alert.targetId,
      mountpointId: null,
      title: alert.title,
      message: alert.message,
      status: alert.status,
      createdAt: alert.createdAt,
      lastSeen: alert.createdAt
    }));
    for (const row of qualityRows) {
      incidents.push({
        source: 'quality',
        id: Number(row.id),
        severity: severityForLevel(String(row.level)),
        level: String(row.level),
        targetType: String(row.target_type),
        targetId: row.target_id === null ? null : Number(row.target_id),
        mountpointId: row.mountpoint_id === null ? null : Number(row.mountpoint_id),
        title: `Chất lượng RTCM · ${String(row.code)}`,
        message: String(row.event_type ?? ''),
        status: 'open',
        createdAt: row.first_seen,
        lastSeen: row.last_seen
      });
    }

    const impacts = await buildAlertImpacts(
      incidents.map((item) => ({
        key: `${item.source}:${item.id}`,
        targetType: item.targetType,
        targetId: item.targetId,
        mountpointId: item.mountpointId
      }))
    );
    const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    incidents.sort((a, b) => {
      const rank = (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3);
      if (rank !== 0) return rank;
      return new Date(b.lastSeen ?? b.createdAt).getTime() - new Date(a.lastSeen ?? a.createdAt).getTime();
    });
    const incidentCounts = { total: incidents.length, critical: 0, warning: 0, info: 0 };
    for (const item of incidents) {
      if (item.severity === 'critical') incidentCounts.critical += 1;
      else if (item.severity === 'warning') incidentCounts.warning += 1;
      else incidentCounts.info += 1;
    }

    const stationScope = scopeOf(perms, 'stations.view');
    const stationRows = await adminQuery<RowDataPacket[]>(
      'SELECT id, status, enabled, owner_web_user_id FROM stations'
    );
    const stations = { total: 0, active: 0, disabled: 0, locked: 0, other: 0 };
    if (stationScope !== 'none') {
      const stationIds = idsFor(stationScope);
      for (const row of stationRows) {
        if (!inScope(stationScope, auth.id, stationIds, row.owner_web_user_id)) continue;
        stations.total += 1;
        const status = String(row.status ?? (row.enabled ? 'active' : 'disabled'));
        if (status === 'active') stations.active += 1;
        else if (status === 'disabled') stations.disabled += 1;
        else if (status === 'locked') stations.locked += 1;
        else stations.other += 1;
      }
    }

    const accountScope = scopeOf(perms, 'ntrip_accounts.view');
    const accountRows = await adminQuery<RowDataPacket[]>(
      'SELECT id, enabled, valid_from, valid_to, owner_web_user_id FROM ntrip_accounts'
    );
    const ntripAccounts = { total: 0, active: 0, disabled: 0, expired: 0, other: 0 };
    const now = Date.now();
    if (accountScope !== 'none') {
      const accountIds = idsFor(accountScope);
      for (const row of accountRows) {
        if (!inScope(accountScope, auth.id, accountIds, row.owner_web_user_id)) continue;
        ntripAccounts.total += 1;
        const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null;
        const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null;
        if (!row.enabled) ntripAccounts.disabled += 1;
        else if (validTo !== null && validTo < now) ntripAccounts.expired += 1;
        else if (validFrom !== null && validFrom > now) ntripAccounts.other += 1;
        else ntripAccounts.active += 1;
      }
    }

    const relayScope = scopeOf(perms, 'relay.view');
    const relayState = new Map(raw.relay.map((item) => [item.jobId, item.state]));
    const relays = { total: 0, streaming: 0, disabled: 0, error: 0, other: 0 };
    if (relayScope !== 'none') {
      const relayIds = idsFor(relayScope);
      for (const job of raw.jobs) {
        if (!inScope(relayScope, auth.id, relayIds, job.ownerId)) continue;
        relays.total += 1;
        if (!job.enabled) relays.disabled += 1;
        else if (relayState.get(job.id) === 'error') relays.error += 1;
        else if (relayState.get(job.id) === 'streaming') relays.streaming += 1;
        else relays.other += 1;
      }
    }

    const topIncidents = incidents.slice(0, 5).map((item) => ({
      ...item,
      impact: impacts.get(`${item.source}:${item.id}`) ?? null
    }));

    let recentAudit: any[] = [];
    const auditScope = scopeOf(perms, 'audit.view');
    if (auditScope !== 'none') {
      let where = '1=1';
      let params: unknown[] = [];
      if (auditScope !== 'all') {
        const auditIds = idsFor(auditScope);
        if (auditIds.length === 0) {
          where = '1=0';
        } else {
          where = `a.actor_web_user_id IN (${auditIds.map(() => '?').join(',')})`;
          params = auditIds;
        }
      }
      const rows = await adminQuery<RowDataPacket[]>(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
                u.username AS actor_name
           FROM audit_logs a
           LEFT JOIN web_users u ON u.id = a.actor_web_user_id
          WHERE ${where}
          ORDER BY a.id DESC LIMIT 5`,
        params
      );
      recentAudit = rows.map((row) => ({
        id: Number(row.id),
        actorName: row.actor_name ? String(row.actor_name) : '',
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: row.entity_id ? String(row.entity_id) : '',
        createdAt: row.created_at
      }));
    }

    let health: any = null;
    if (scopeOf(perms, 'system_health.view') !== 'none') {
      try {
        const metrics = await getSystemHealth();
        health = {
          status: metrics.status,
          node: metrics.node.status,
          host: metrics.host.status,
          mysql: metrics.mysql.status,
          go: metrics.go.status,
          generatedAt: metrics.generatedAt
        };
      } catch {
        health = { status: 'unknown', node: 'unknown', host: 'unknown', mysql: 'unknown', go: 'unknown' };
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      windowMinutes: Math.max(1, Math.min(1440, Number(req.query.window || 60) || 60)),
      stations,
      ntripAccounts,
      relays,
      incidentsCount: incidentCounts,
      incidentsToday,
      summary: {
        stations: snapshot.summary.stations,
        mountpoints,
        relayTotal: snapshot.summary.relayTotal,
        relayStreaming: snapshot.summary.relayStreaming,
        relayIssues:
          snapshot.summary.relayBackoff +
          snapshot.summary.relayError +
          snapshot.summary.relayPending,
        onlineConnections: snapshot.summary.connections,
        onlineAccounts,
        openAlerts: snapshot.summary.openAlerts,
        qualityOpen,
        incidents: incidents.length,
        goAvailable: raw.goOk,
        casterAvailable: raw.casterOk
      },
      health,
      incidents: topIncidents,
      recentAudit
    });
  })
);
