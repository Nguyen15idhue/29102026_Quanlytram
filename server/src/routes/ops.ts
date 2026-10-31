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
import { inScope, subtreeIds } from '../rbac/scope';
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

opsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const ids = await subtreeIds(auth.id);
    const [permissions, raw, openAlerts] = await Promise.all([
      permissionsForRole(auth.roleId),
      loadBaseData(),
      loadOpenAlerts()
    ]);
    const perms = permissionMap(permissions);
    const snapshot = buildSnapshot(raw, openAlerts, perms, auth.id, ids);

    const mountScope = scopeOf(perms, 'mountpoints.view');
    const mountpoints = raw.mountpoints.filter((item) =>
      inScope(mountScope, auth.id, ids, item.ownerId)
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
    if (qualityScope !== 'none') {
      const stationIds = raw.stations
        .filter((item) => inScope(qualityScope, auth.id, ids, item.ownerId))
        .map((item) => item.id);
      const relayIds = raw.jobs
        .filter((item) => inScope(qualityScope, auth.id, ids, item.ownerId))
        .map((item) => item.id);
      const where = qualityWhere(stationIds, relayIds);
      [qualityRows, [{ count: qualityOpen }]] = await Promise.all([
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
        )
      ]);
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
    const topIncidents = incidents.slice(0, 20).map((item) => ({
      ...item,
      impact: impacts.get(`${item.source}:${item.id}`) ?? null
    }));

    let recentAudit: any[] = [];
    const auditScope = scopeOf(perms, 'audit.view');
    if (auditScope !== 'none') {
      let where = '1=1';
      let params: unknown[] = [];
      if (auditScope !== 'all') {
        if (ids.length === 0) {
          where = '1=0';
        } else {
          where = `a.actor_web_user_id IN (${ids.map(() => '?').join(',')})`;
          params = ids;
        }
      }
      const rows = await adminQuery<RowDataPacket[]>(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
                u.username AS actor_name
           FROM audit_logs a
           LEFT JOIN web_users u ON u.id = a.actor_web_user_id
          WHERE ${where}
          ORDER BY a.id DESC LIMIT 8`,
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
    if (scopeOf(perms, 'settings.view') !== 'none') {
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
