import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminPool, closePool, withTransaction } from './pool';
import { encryptSecret } from '../lib/crypto';
import { endpointKey } from '../lib/endpointKey';
import { TOMBSTONE_KEY_SQL } from '../lib/tombstone';

interface OldRelayJob {
  id?: string | number;
  enable?: boolean;
  src_host?: string;
  src_port?: number;
  src_mount?: string;
  src_user?: string;
  src_pass?: string;
  src_proxy?: string;
  src_use_ssl?: boolean;
  src_ntrip_version?: string;
  dst_host?: string;
  dst_port?: number;
  dst_mount?: string;
  dst_user?: string;
  dst_pass?: string;
  dst_proxy?: string;
  dst_use_ssl?: boolean;
  dst_ntrip_version?: string;
  lat?: number;
  lon?: number;
  nmea_interval_sec?: number;
}

interface ImportOptions {
  file: string;
  dryRun: boolean;
  force: boolean;
  ids: Set<string> | null;
  ownerId: number | null;
}

interface ImportSummary {
  file: string;
  sha256: string;
  selected: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ImportOptions {
  let file = '';
  let dryRun = false;
  let force = false;
  let ids: Set<string> | null = null;
  let ownerId: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--file' || arg === '--ids' || arg === '--owner') {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      if (arg === '--file') file = value;
      if (arg === '--ids') ids = new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
      if (arg === '--owner') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--owner must be a positive integer');
        ownerId = parsed;
      }
      continue;
    }
    if (arg.startsWith('--file=')) file = arg.slice('--file='.length);
    else if (arg.startsWith('--ids=')) ids = new Set(arg.slice('--ids='.length).split(',').map((item) => item.trim()).filter(Boolean));
    else if (arg.startsWith('--owner=')) {
      const parsed = Number(arg.slice('--owner='.length));
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--owner must be a positive integer');
      ownerId = parsed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!file) throw new Error('--file is required');
  return { file, dryRun, force, ids, ownerId };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing ${field}`);
  return value.trim();
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeJob(raw: OldRelayJob) {
  const externalKey = requiredString(raw.id, 'id');
  const upstream = {
    host: requiredString(raw.src_host, 'src_host'),
    port: optionalNumber(raw.src_port) ?? 2101,
    mount: requiredString(raw.src_mount, 'src_mount'),
    proxy: typeof raw.src_proxy === 'string' ? raw.src_proxy : '',
    ssl: optionalBoolean(raw.src_use_ssl),
    ntripVersion: raw.src_ntrip_version === 'v1' ? 'v1' : 'v2'
  };
  const downstream = {
    host: requiredString(raw.dst_host, 'dst_host'),
    port: optionalNumber(raw.dst_port) ?? 2101,
    mount: requiredString(raw.dst_mount, 'dst_mount'),
    proxy: typeof raw.dst_proxy === 'string' ? raw.dst_proxy : '',
    ssl: optionalBoolean(raw.dst_use_ssl),
    ntripVersion: raw.dst_ntrip_version === 'v1' ? 'v1' : 'v2'
  };
  return {
    externalKey,
    name: `import ${externalKey}`,
    upstream,
    downstream,
    upstreamKey: endpointKey(upstream),
    downstreamKey: endpointKey(downstream),
    lat: optionalNumber(raw.lat),
    lon: optionalNumber(raw.lon),
    nmeaIntervalSec: Math.max(0, Math.trunc(optionalNumber(raw.nmea_interval_sec) ?? 0)),
    upstreamCredential:
      typeof raw.src_user === 'string' && raw.src_user.trim() !== ''
        ? { username: raw.src_user.trim(), password: typeof raw.src_pass === 'string' ? raw.src_pass : '' }
        : null,
    downstreamCredential:
      typeof raw.dst_user === 'string' && raw.dst_user.trim() !== ''
        ? { username: raw.dst_user.trim(), password: typeof raw.dst_pass === 'string' ? raw.dst_pass : '' }
        : null
  };
}

async function upsertCredential(
  conn: any,
  name: string,
  credential: { username: string; password: string } | null,
  ownerId: number | null,
  existingId: number | null
): Promise<number | null> {
  if (!credential) return null;
  if (existingId) {
    await conn.query(
      'UPDATE relay_credentials SET name = ?, username = ?, password_enc = ?, owner_web_user_id = ? WHERE id = ?',
      [name, credential.username, encryptSecret(credential.password), ownerId, existingId]
    );
    return Number(existingId);
  }
  const [rows]: any = await conn.query(
    'SELECT id FROM relay_credentials WHERE name = ? AND owner_web_user_id <=> ? LIMIT 1',
    [name, ownerId]
  );
  if (rows.length > 0) {
    await conn.query(
      'UPDATE relay_credentials SET username = ?, password_enc = ? WHERE id = ?',
      [credential.username, encryptSecret(credential.password), rows[0].id]
    );
    return Number(rows[0].id);
  }
  const [result]: any = await conn.query(
    'INSERT INTO relay_credentials (name, username, password_enc, owner_web_user_id, company_id, created_by) VALUES (?, ?, ?, ?, (SELECT company_id FROM web_users WHERE id = ?), NULL)',
    [name, credential.username, encryptSecret(credential.password), ownerId, ownerId]
  );
  return Number(result.insertId);
}

async function importJobs(options: ImportOptions): Promise<ImportSummary> {
  const rawText = await readFile(options.file, 'utf8');
  const sha256 = createHash('sha256').update(rawText).digest('hex');
  const parsed = JSON.parse(rawText) as OldRelayJob[];
  if (!Array.isArray(parsed)) throw new Error('config file must be a JSON array');

  const jobs = parsed
    .filter((job) => !options.ids || options.ids.has(String(job.id)))
    .map(normalizeJob);

  const summary: ImportSummary = {
    file: options.file,
    sha256,
    selected: jobs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    dryRun: options.dryRun
  };

  if (options.dryRun) {
    for (const job of jobs) {
      const [rows]: any = await adminPool.query(
        'SELECT id FROM relay_jobs WHERE external_key = ? AND deleted_at IS NULL LIMIT 1',
        [job.externalKey]
      );
      if (rows.length > 0 && !options.force) summary.skipped += 1;
      else if (rows.length > 0) summary.updated += 1;
      else summary.created += 1;
    }
    return summary;
  }

  await withTransaction(async (conn) => {
    for (const job of jobs) {
      const [existingRows]: any = await conn.query(
        `SELECT id, upstream_credential_id, downstream_credential_id, deleted_at
           FROM relay_jobs WHERE external_key = ? LIMIT 1`,
        [job.externalKey]
      );
      let existing = existingRows[0] ?? null;
      if (existing && existing.deleted_at !== null) {
        await conn.query(
          `UPDATE relay_jobs
              SET ${TOMBSTONE_KEY_SQL}, desired_revision = desired_revision + 1
            WHERE id = ?`,
          [Number(existing.id)]
        );
        existing = null;
      }
      if (existing && !options.force) {
        summary.skipped += 1;
        continue;
      }

      const upstreamCredentialId = await upsertCredential(
        conn,
        `import:${job.externalKey}:upstream`,
        job.upstreamCredential,
        options.ownerId,
        existing ? existing.upstream_credential_id : null
      );
      const downstreamCredentialId = await upsertCredential(
        conn,
        `import:${job.externalKey}:downstream`,
        job.downstreamCredential,
        options.ownerId,
        existing ? existing.downstream_credential_id : null
      );

      const values = [
        job.externalKey,
        job.name,
        job.upstream.host,
        job.upstream.port,
        job.upstream.mount,
        upstreamCredentialId,
        job.upstream.proxy,
        job.upstream.ssl,
        job.upstream.ntripVersion,
        job.downstream.host,
        job.downstream.port,
        job.downstream.mount,
        downstreamCredentialId,
        job.downstream.proxy,
        job.downstream.ssl,
        job.downstream.ntripVersion,
        job.lat,
        job.lon,
        job.nmeaIntervalSec,
        job.upstreamKey,
        job.downstreamKey,
        options.ownerId,
        sha256
      ];

      if (existing) {
        await conn.query(
          `UPDATE relay_jobs SET
             name = ?, upstream_host = ?, upstream_port = ?, upstream_mount = ?, upstream_credential_id = ?,
             upstream_proxy = ?, upstream_ssl = ?, upstream_ntrip_version = ?,
             downstream_host = ?, downstream_port = ?, downstream_mount = ?, downstream_credential_id = ?,
             downstream_proxy = ?, downstream_ssl = ?, downstream_ntrip_version = ?,
             lat = ?, lon = ?, nmea_interval_sec = ?, upstream_key = ?, downstream_key = ?,
             owner_web_user_id = ?, source_sha256 = ?, imported_at = UTC_TIMESTAMP(3),
             desired_revision = desired_revision + 1
           WHERE id = ?`,
          [...values.slice(1), existing.id]
        );
        summary.updated += 1;
      } else {
        await conn.query(
          `INSERT INTO relay_jobs (
             external_key, name, enabled,
             upstream_host, upstream_port, upstream_mount, upstream_credential_id,
             upstream_proxy, upstream_ssl, upstream_ntrip_version,
             downstream_host, downstream_port, downstream_mount, downstream_credential_id,
             downstream_proxy, downstream_ssl, downstream_ntrip_version,
             downstream_mode, lat, lon, nmea_interval_sec,
             upstream_key, downstream_key, origin, origin_ref, source_sha256,
             desired_revision, owner_web_user_id, imported_at
           ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'post', ?, ?, ?, ?, ?, 'import', ?, ?, 1, ?, UTC_TIMESTAMP(3))`,
          [
            job.externalKey,
            job.name,
            job.upstream.host,
            job.upstream.port,
            job.upstream.mount,
            upstreamCredentialId,
            job.upstream.proxy,
            job.upstream.ssl,
            job.upstream.ntripVersion,
            job.downstream.host,
            job.downstream.port,
            job.downstream.mount,
            downstreamCredentialId,
            job.downstream.proxy,
            job.downstream.ssl,
            job.downstream.ntripVersion,
            job.lat,
            job.lon,
            job.nmeaIntervalSec,
            job.upstreamKey,
            job.downstreamKey,
            job.externalKey,
            sha256,
            options.ownerId
          ]
        );
        summary.created += 1;
      }
    }
  });

  return summary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await importJobs(options);
  console.log(JSON.stringify(summary));
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`[import-relay] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
