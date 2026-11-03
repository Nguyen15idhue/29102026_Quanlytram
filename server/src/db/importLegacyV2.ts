import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminPool, closePool, query, withTransaction } from './pool';
import { hashPassword } from '../lib/password';
import { writeAudit } from '../lib/audit';
import { endpointKey } from '../lib/endpointKey';
import { upsertRelayCredential } from '../lib/relayCredentials';

/**
 * Import tài nguyên hệ thống CORS cũ (db/data) sang hệ thống hiện tại.
 * Mặc định chỉ dry-run; chỉ ghi DB khi truyền --apply.
 */

export interface LegacyStation {
  code: string;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  sourceType: string;
  ntripVersion: 'v1' | 'v2';
  lat: number | null;
  lon: number | null;
  notes: string;
}

export interface LegacyMountpoint {
  name: string;
  stationCode: string;
  ports: number[];
  enabled: boolean;
}

export interface LegacyRelay {
  externalKey: string;
  name: string;
  legacyEnabled: boolean;
  srcHost: string;
  srcPort: number;
  srcMount: string;
  srcUser: string;
  srcPass: string;
  srcProxy: string;
  srcSsl: boolean;
  dstHost: string;
  dstPort: number;
  dstMount: string;
  dstUser: string;
  dstPass: string;
  dstProxy: string;
  dstSsl: boolean;
  lat: number | null;
  lon: number | null;
}

export interface LegacyAccount {
  username: string;
  password: string;
  readMounts: string[];
  writeMounts: string[];
}

export interface ImportPlan {
  stations: LegacyStation[];
  mountpoints: LegacyMountpoint[];
  relays: LegacyRelay[];
  accounts: LegacyAccount[];
  issues: string[];
  checksum: string;
}

const COORDINATES: Record<string, [number, number]> = {
  BDH: [14.05, 108.95],
  BG: [21.27, 106.2],
  BKN: [22.15, 105.83],
  BTE: [10.24, 106.38],
  CMU: [9.18, 105.15],
  DTP: [10.45, 105.63],
  GLI: [13.98, 108.0],
  HBH: [20.82, 105.34],
  HUG: [9.78, 105.47],
  KGG: [10.01, 105.08],
  LCI: [22.49, 103.97],
  PYN: [13.09, 109.3],
  QBH: [17.47, 106.6],
  QNH: [21.0, 107.3],
  SLA: [21.33, 103.91],
  THA: [19.8, 105.78],
  TNN: [21.59, 105.85],
  TQG: [21.82, 105.21],
  YBI: [21.72, 104.9],
  hauloc: [19.93, 105.75],
  MocChautest: [20.85, 104.63]
};

const NOTES_ASSUMED = 'Quét sourcetable 2026-10-31; host rtktk.online; toạ độ giả định, chờ 1005/1006';

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export function stationCodeFromMountpoint(value: string): string {
  return value.trim().replace(/\./g, '_');
}

export function coordinateFor(code: string): [number, number] | null {
  const normalized = code.trim();
  const lower = normalized.toLowerCase();
  const exact = Object.keys(COORDINATES).find((key) => key.toLowerCase() === lower);
  if (exact) return COORDINATES[exact];
  const match = lower.match(/^[a-z]+/);
  const prefix = match?.[0] ?? '';
  const matched = Object.keys(COORDINATES).find((key) => key.toLowerCase() === prefix);
  return matched ? COORDINATES[matched] : null;
}

function parsePorts(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((item) => Number(item)).filter((item) => item > 0);
  return String(raw ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function buildPlan(dataDir: string): ImportPlan {
  const stationsRaw = JSON.parse(readFileSync(join(dataDir, 'caster_stations.json'), 'utf8'));
  const stationsList: any[] = Array.isArray(stationsRaw)
    ? stationsRaw
    : stationsRaw.stations ?? stationsRaw.items ?? [];
  const mountpointLines = readFileSync(join(dataDir, 'caster_mountpoints.csv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1);
  const relaysRaw = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));
  const relaysList: any[] = Array.isArray(relaysRaw) ? relaysRaw : [];

  const issues: string[] = [];
  const stations: LegacyStation[] = [];
  const seenStation = new Map<string, string>();
  for (const raw of stationsList) {
    const rawCode = text(raw.code) || text(raw.name);
    const code = stationCodeFromMountpoint(rawCode);
    if (!code) {
      issues.push(`Bỏ trạm không có mã: ${text(raw.name)}`);
      continue;
    }
    if (seenStation.has(code.toLowerCase())) {
      issues.push(`Trùng mã trạm (không phân biệt hoa/thường): ${rawCode}`);
      continue;
    }
    seenStation.set(code.toLowerCase(), code);
    const coord = coordinateFor(code);
    stations.push({
      code,
      name: text(raw.name) || rawCode,
      enabled: raw.enabled !== false,
      host: text(raw.host) || 'rtktk.online',
      port: Number(raw.port) || 1509,
      sourceType: text(raw.source_type) || 'manual',
      ntripVersion: raw.ntrip_version === 'v2' ? 'v2' : 'v1',
      lat: numberOrNull(raw.lat) ?? coord?.[0] ?? null,
      lon: numberOrNull(raw.lon) ?? coord?.[1] ?? null,
      notes: NOTES_ASSUMED
    });
    if (!coord) issues.push(`Không có toạ độ giả định cho prefix: ${code}`);
  }

  const mountpoints: LegacyMountpoint[] = [];
  const seenMount = new Map<string, LegacyMountpoint>();
  for (const line of mountpointLines) {
    const row = parseCsvLine(line);
    const name = text(row[0]);
    if (!name) continue;
    // in_caster=0: trạm chỉ xuất hiện trong relay config, không có mountpoint local.
    if (text(row[7]) !== '1') continue;
    const stationCode = stationCodeFromMountpoint(text(row[1]) || name);
    const ports = parsePorts(row[3]);
    const key = name.toLowerCase();
    if (seenMount.has(key)) {
      const existing = seenMount.get(key)!;
      for (const port of ports) if (!existing.ports.includes(port)) existing.ports.push(port);
      issues.push(`Mountpoint trùng tên: ${name}`);
      continue;
    }
    const entry: LegacyMountpoint = {
      name,
      stationCode,
      ports: ports.length > 0 ? ports : [1509],
      enabled: row[7] === '1'
    };
    seenMount.set(key, entry);
    mountpoints.push(entry);
    if (!seenStation.has(stationCode.toLowerCase())) {
      issues.push(`Mountpoint ${name} không có trạm tương ứng: ${stationCode}`);
    }
  }

  const relays: LegacyRelay[] = [];
  const seenRelay = new Map<string, string>();
  const accounts = new Map<string, LegacyAccount>();
  const addAcl = (user: string, pass: string, mount: string, mode: 'read' | 'write') => {
    if (!user) return;
    const entry = accounts.get(user) ?? {
      username: user,
      password: '',
      readMounts: [],
      writeMounts: []
    };
    if (!entry.password && pass) entry.password = pass;
    const list = mode === 'read' ? entry.readMounts : entry.writeMounts;
    if (mount && !list.includes(mount)) list.push(mount);
    accounts.set(user, entry);
  };

  for (const raw of relaysList) {
    const externalKey = text(raw.id);
    if (!externalKey) {
      issues.push('Relay không có id, bỏ qua');
      continue;
    }
    if (seenRelay.has(externalKey)) {
      issues.push(`Relay trùng id: ${externalKey}`);
      continue;
    }
    seenRelay.set(externalKey, externalKey);
    const relay: LegacyRelay = {
      externalKey,
      name: externalKey,
      legacyEnabled: raw.enable === true,
      srcHost: text(raw.src_host),
      srcPort: Number(raw.src_port) || 1509,
      srcMount: text(raw.src_mount),
      srcUser: text(raw.src_user),
      srcPass: text(raw.src_pass),
      srcProxy: text(raw.src_proxy),
      srcSsl: raw.src_use_ssl === true,
      dstHost: text(raw.dst_host),
      dstPort: Number(raw.dst_port) || 1509,
      dstMount: text(raw.dst_mount),
      dstUser: text(raw.dst_user),
      dstPass: text(raw.dst_pass),
      dstProxy: text(raw.dst_proxy),
      dstSsl: raw.dst_use_ssl === true,
      lat: numberOrNull(raw.lat),
      lon: numberOrNull(raw.lon)
    };
    if (!relay.srcHost || !relay.srcMount || !relay.dstHost || !relay.dstMount) {
      issues.push(`Relay ${externalKey} thiếu host/mount nguồn hoặc đích`);
    }
    if (
      relay.srcHost.toLowerCase() === relay.dstHost.toLowerCase() &&
      relay.srcPort === relay.dstPort &&
      relay.srcMount.toLowerCase() === relay.dstMount.toLowerCase()
    ) {
      issues.push(`Relay ${externalKey} tự loop (nguồn = đích)`);
    }
    if (relay.srcHost === 'rtktk.online') {
      addAcl(relay.srcUser, relay.srcPass, relay.srcMount, 'read');
    }
    if (relay.dstHost === 'rtktk.online') {
      addAcl(relay.dstUser, relay.dstPass, relay.dstMount, 'write');
    }
    relays.push(relay);
  }

  for (const account of accounts.values()) {
    if (!account.password) issues.push(`Account ${account.username} thiếu mật khẩu`);
  }

  const checksum = createHash('sha256')
    .update(
      JSON.stringify({
        stations: stations.map((item) => item.code).sort(),
        mountpoints: mountpoints.map((item) => item.name.toLowerCase()).sort(),
        relays: relays.map((item) => item.externalKey).sort()
      })
    )
    .digest('hex');

  return {
    stations,
    mountpoints,
    relays,
    accounts: [...accounts.values()],
    issues,
    checksum
  };
}

export function summarizePlan(plan: ImportPlan) {
  const ports: Record<string, number> = {};
  for (const mountpoint of plan.mountpoints) {
    for (const port of mountpoint.ports) ports[String(port)] = (ports[String(port)] ?? 0) + 1;
  }
  const legacyEnabled = plan.relays.filter((relay) => relay.legacyEnabled).length;
  return {
    stations: plan.stations.length,
    stationsWithMountpoint: new Set(
      plan.mountpoints.map((mountpoint) => mountpoint.stationCode.toLowerCase())
    ).size,
    mountpoints: plan.mountpoints.length,
    mountpointPorts: ports,
    relays: plan.relays.length,
    relaysLegacyEnabled: legacyEnabled,
    relaysImportDisabled: plan.relays.length,
    accounts: plan.accounts.map((account) => ({
      username: account.username,
      hasPassword: Boolean(account.password),
      readMounts: account.readMounts.length,
      writeMounts: account.writeMounts.length
    })),
    issues: plan.issues,
    checksum: plan.checksum
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const applyCore = args.includes('--apply-core');
  const applyRelays = args.includes('--apply-relays');
  const apply = args.includes('--apply');
  const dataIndex = args.indexOf('--data');
  const dataDir = dataIndex >= 0 ? args[dataIndex + 1] : 'db/data';
  const plan = buildPlan(dataDir);
  const summary = summarizePlan(plan);
  console.log(
    JSON.stringify(
      {
        mode: applyCore ? 'apply-core' : applyRelays ? 'apply-relays' : apply ? 'apply' : 'dry-run',
        dataDir,
        ...summary
      },
      null,
      2
    )
  );
  if (applyCore || applyRelays) {
    (applyCore ? applyCorePlan(plan) : applyRelayPlan(plan))
      .then(async () => {
        await closePool();
        process.exit(0);
      })
      .catch(async (error) => {
        console.error(`[import-legacy] ${error.message}`);
        await closePool();
        process.exit(1);
      });
    return;
  }
  if (apply) {
    throw new Error('Dùng --apply-core (trạm/mountpoint/account) hoặc --apply-relays (relay)');
  }
  if (plan.issues.length > 0) {
    console.error(`[import-legacy] ${plan.issues.length} cảnh báo cần xem trước khi apply`);
  }
}

async function applyCorePlan(plan: ImportPlan): Promise<void> {
  const companyRows = await query<any[]>('SELECT id FROM companies WHERE code = ? LIMIT 1', [
    'WALLY'
  ]);
  const userRows = await query<any[]>('SELECT id FROM web_users WHERE username = ? LIMIT 1', [
    'wally'
  ]);
  const superRows = await query<any[]>(
    `SELECT u.id FROM web_users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1`
  );
  const companyId = Number(companyRows[0]?.id ?? 0);
  const wallyId = Number(userRows[0]?.id ?? 0);
  const superId = Number(superRows[0]?.id ?? 0);
  if (!companyId || !wallyId || !superId) {
    throw new Error('Thiếu WALLY/wally/superadmin; chạy db:reset-legacy trước');
  }

  const listeners = await query<any[]>('SELECT id, port FROM caster_listeners');
  const listenerByPort = new Map<number, number>(
    listeners.map((row) => [Number(row.port), Number(row.id)])
  );

  const stationIdByCode = new Map<string, number>();
  const mountpointIds = new Map<string, number>();
  let stationCreated = 0;
  let mountpointCreated = 0;
  let sourceCreated = 0;

  await withTransaction(async (conn) => {
    for (const station of plan.stations) {
      const [existing] = await conn.query<any[]>('SELECT id FROM stations WHERE name = ? LIMIT 1', [
        station.name
      ]);
      let stationId = Number(existing[0]?.id ?? 0);
      if (!stationId) {
        const [result] = await conn.query<any>(
          `INSERT INTO stations
             (name, host, port, connection_type, lat, lon, notes, owner_web_user_id, created_by,
              station_type, enabled, protocol, source_type, ntrip_version, ntrip_mode, status,
              company_id)
           VALUES (?, ?, ?, 'ntrip', ?, ?, ?, ?, ?, 'reference', ?, 'ntrip', ?, ?, ?, 'active', ?)`,
          [
            station.name,
            station.host,
            station.port,
            station.lat,
            station.lon,
            station.notes,
            wallyId,
            superId,
            station.enabled ? 1 : 0,
            station.sourceType,
            station.ntripVersion,
            'v1_noauth',
            companyId
          ]
        );
        stationId = Number(result.insertId);
        stationCreated += 1;
      } else {
        await conn.query(
          `UPDATE stations SET host = ?, port = ?, lat = ?, lon = ?, notes = ?,
             owner_web_user_id = ?, company_id = ?, source_type = ?, ntrip_version = ?,
             ntrip_mode = 'v1_noauth', enabled = ?
           WHERE id = ?`,
          [
            station.host,
            station.port,
            station.lat,
            station.lon,
            station.notes,
            wallyId,
            companyId,
            station.sourceType,
            station.ntripVersion,
            station.enabled ? 1 : 0,
            stationId
          ]
        );
      }
      stationIdByCode.set(stationCodeFromMountpoint(station.name).toLowerCase(), stationId);
    }

    for (const mountpoint of plan.mountpoints) {
      const stationId = stationIdByCode.get(mountpoint.stationCode.toLowerCase());
      if (!stationId) throw new Error(`Mountpoint ${mountpoint.name} thiếu trạm ${mountpoint.stationCode}`);
      const [existing] = await conn.query<any[]>(
        'SELECT id FROM mountpoints WHERE name = ? LIMIT 1',
        [mountpoint.name]
      );
      let mountpointId = Number(existing[0]?.id ?? 0);
      if (!mountpointId) {
        const [result] = await conn.query<any>(
          `INSERT INTO mountpoints
             (name, station_id, enabled, requires_auth, owner_web_user_id, created_by,
              description, company_id)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            mountpoint.name,
            stationId,
            mountpoint.enabled ? 1 : 0,
            wallyId,
            superId,
            'Chuyển từ hệ thống CORS cũ',
            companyId
          ]
        );
        mountpointId = Number(result.insertId);
        mountpointCreated += 1;
      } else {
        await conn.query(
          `UPDATE mountpoints SET station_id = ?, enabled = ?, requires_auth = 1,
             owner_web_user_id = ?, company_id = ? WHERE id = ?`,
          [stationId, mountpoint.enabled ? 1 : 0, wallyId, companyId, mountpointId]
        );
      }
      mountpointIds.set(mountpoint.name.toLowerCase(), mountpointId);
      for (const port of mountpoint.ports) {
        const listenerId = listenerByPort.get(port);
        if (!listenerId) throw new Error(`Thiếu listener port ${port}`);
        await conn.query(
          'INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
          [listenerId, mountpointId]
        );
      }
      const primaryPort = mountpoint.ports.includes(1509) ? 1509 : mountpoint.ports[0];
      const listenerId = listenerByPort.get(primaryPort);
      await conn.query(
        `INSERT INTO station_sources
           (station_id, source_role, caster_version, caster_username, caster_password_enc,
            caster_requires_auth, caster_listener_id)
         VALUES (?, 'ntrip_caster', 'v1', ?, NULL, 0, ?)
         ON DUPLICATE KEY UPDATE
           source_role = 'ntrip_caster', caster_version = 'v1', caster_username = VALUES(caster_username),
           caster_password_enc = NULL, caster_requires_auth = 0,
           caster_listener_id = VALUES(caster_listener_id)`,
        [stationId, mountpoint.stationCode, listenerId ?? null]
      );
      sourceCreated += 1;
    }

    for (const account of plan.accounts) {
      const passwordHash = await hashPassword(account.password);
      await conn.query(
        `INSERT INTO ntrip_accounts
           (username, password_hash, enabled, max_connections, owner_web_user_id, created_by,
            company, company_id, notes)
         VALUES (?, ?, 1, 50, ?, ?, 'Wally', ?, 'Chuyển từ hệ thống CORS cũ')
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash), enabled = 1, owner_web_user_id = VALUES(owner_web_user_id),
           company_id = VALUES(company_id)`,
        [account.username, passwordHash, wallyId, superId, companyId]
      );
      const [accountRows] = await conn.query<any[]>(
        'SELECT id FROM ntrip_accounts WHERE username = ? LIMIT 1',
        [account.username]
      );
      const accountId = Number(accountRows[0]?.id ?? 0);
      await conn.query('DELETE FROM account_mountpoint_acl WHERE account_id = ?', [accountId]);
      for (const mountName of [...account.readMounts, ...account.writeMounts]) {
        const mountpointId = mountpointIds.get(mountName.toLowerCase());
        if (!mountpointId) continue;
        await conn.query(
          'INSERT IGNORE INTO account_mountpoint_acl (account_id, mountpoint_id) VALUES (?, ?)',
          [accountId, mountpointId]
        );
      }
    }
  });

  await writeAudit(
    adminPool,
    superId,
    'import',
    'legacy_core',
    0,
    null,
    {
      stations: plan.stations.length,
      stationCreated,
      mountpoints: plan.mountpoints.length,
      mountpointCreated,
      sources: sourceCreated,
      accounts: plan.accounts.map((account) => account.username),
      checksum: plan.checksum
    },
    '127.0.0.1'
  );
  console.log(
    `[import-legacy] core OK: trạm tạo ${stationCreated}/${plan.stations.length}, ` +
      `mountpoint tạo ${mountpointCreated}/${plan.mountpoints.length}, source ${sourceCreated}, ` +
      `account ${plan.accounts.length}`
  );
}

async function applyRelayPlan(plan: ImportPlan): Promise<void> {
  const companyRows = await query<any[]>('SELECT id FROM companies WHERE code = ? LIMIT 1', ['WALLY']);
  const userRows = await query<any[]>('SELECT id FROM web_users WHERE username = ? LIMIT 1', ['wally']);
  const superRows = await query<any[]>(
    `SELECT u.id FROM web_users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1`
  );
  const companyId = Number(companyRows[0]?.id ?? 0);
  const wallyId = Number(userRows[0]?.id ?? 0);
  const superId = Number(superRows[0]?.id ?? 0);
  if (!companyId || !wallyId || !superId) {
    throw new Error('Thiếu WALLY/wally/superadmin; chạy db:reset-legacy + --apply-core trước');
  }

  let created = 0;
  let updated = 0;
  const missingCredential: string[] = [];

  await withTransaction(async (conn) => {
    for (const relay of plan.relays) {
      const [existingRows] = await conn.query<any[]>(
        'SELECT id, upstream_credential_id, downstream_credential_id FROM relay_jobs WHERE external_key = ? LIMIT 1',
        [relay.externalKey]
      );
      const existing = existingRows[0];
      const upstreamCredentialId = await upsertRelayCredential(
        conn,
        relay.srcUser && relay.srcPass ? { username: relay.srcUser, password: relay.srcPass } : null,
        existing?.upstream_credential_id ? Number(existing.upstream_credential_id) : null,
        `${relay.name} upstream`,
        wallyId,
        superId,
        companyId
      );
      if (relay.srcUser && !relay.srcPass) missingCredential.push(`${relay.externalKey} src`);
      const downstreamCredentialId = await upsertRelayCredential(
        conn,
        relay.dstUser && relay.dstPass ? { username: relay.dstUser, password: relay.dstPass } : null,
        existing?.downstream_credential_id ? Number(existing.downstream_credential_id) : null,
        `${relay.name} downstream`,
        wallyId,
        superId,
        companyId
      );
      if (relay.dstUser && !relay.dstPass) missingCredential.push(`${relay.externalKey} dst`);

      const upstreamKey = endpointKey({
        host: relay.srcHost,
        port: relay.srcPort,
        mount: relay.srcMount,
        ssl: relay.srcSsl
      });
      const downstreamKey = endpointKey({
        host: relay.dstHost,
        port: relay.dstPort,
        mount: relay.dstMount,
        ssl: relay.dstSsl
      });
      const tags = JSON.stringify({ legacyEnabled: relay.legacyEnabled, legacyId: relay.externalKey });
      if (existing) {
        await conn.query(
          `UPDATE relay_jobs SET
             name = ?, enabled = 0, locked = 0, deleted_at = NULL,
             upstream_host = ?, upstream_port = ?, upstream_mount = ?, upstream_credential_id = ?,
             upstream_proxy = ?, upstream_ssl = ?, upstream_ntrip_version = 'v2',
             downstream_host = ?, downstream_port = ?, downstream_mount = ?, downstream_credential_id = ?,
             downstream_proxy = ?, downstream_ssl = ?, downstream_ntrip_version = 'v2',
             downstream_mode = 'auto', lat = NULL, lon = NULL, tags = ?,
             origin = 'import', origin_ref = ?, imported_at = CURRENT_TIMESTAMP(3),
             upstream_key = ?, downstream_key = ?, owner_web_user_id = ?, company_id = ?,
             desired_revision = desired_revision + 1
           WHERE id = ?`,
          [
            relay.name,
            relay.srcHost,
            relay.srcPort,
            relay.srcMount,
            upstreamCredentialId,
            relay.srcProxy,
            relay.srcSsl,
            relay.dstHost,
            relay.dstPort,
            relay.dstMount,
            downstreamCredentialId,
            relay.dstProxy,
            relay.dstSsl,
            tags,
            relay.externalKey,
            upstreamKey,
            downstreamKey,
            wallyId,
            companyId,
            existing.id
          ]
        );
        updated += 1;
      } else {
        await conn.query(
          `INSERT INTO relay_jobs
             (external_key, name, enabled, locked,
              upstream_host, upstream_port, upstream_mount, upstream_credential_id,
              upstream_proxy, upstream_ssl, upstream_ntrip_version,
              downstream_host, downstream_port, downstream_mount, downstream_credential_id,
              downstream_proxy, downstream_ssl, downstream_ntrip_version, downstream_mode,
              lat, lon, tags, origin, origin_ref, imported_at, desired_revision,
              upstream_key, downstream_key, owner_web_user_id, company_id, created_by)
           VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?, 'v2', ?, ?, ?, ?, ?, ?, 'v2', 'auto',
              NULL, NULL, ?, 'import', ?, CURRENT_TIMESTAMP(3), 1, ?, ?, ?, ?, ?)`,
          [
            relay.externalKey,
            relay.name,
            relay.srcHost,
            relay.srcPort,
            relay.srcMount,
            upstreamCredentialId,
            relay.srcProxy,
            relay.srcSsl,
            relay.dstHost,
            relay.dstPort,
            relay.dstMount,
            downstreamCredentialId,
            relay.dstProxy,
            relay.dstSsl,
            tags,
            relay.externalKey,
            upstreamKey,
            downstreamKey,
            wallyId,
            companyId,
            superId
          ]
        );
        created += 1;
      }
    }
  });

  await writeAudit(
    adminPool,
    superId,
    'import',
    'legacy_relays',
    0,
    null,
    { created, updated, total: plan.relays.length, missingCredential, checksum: plan.checksum },
    '127.0.0.1'
  );
  console.log(
    `[import-legacy] relay OK: tạo ${created}, cập nhật ${updated}, tổng ${plan.relays.length}; ` +
      `thiếu mật khẩu: ${missingCredential.length}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[import-legacy] ${(error as Error).message}`);
    process.exit(1);
  }
}
