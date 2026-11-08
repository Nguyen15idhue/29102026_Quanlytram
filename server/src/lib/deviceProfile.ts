import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';

export type DeviceVersionTemplate =
  | 'major.minor.patch'
  | 'major.minor.patch.date'
  | 'vmajor.minor.patch'
  | 'major.minor';

export type DeviceRole = 'relay' | 'station' | 'probe';

export interface DeviceProfile {
  id: number;
  code: string;
  name: string;
  vendor: string;
  versionTemplate: DeviceVersionTemplate;
  ntripVersion: 'v1' | 'v2';
  httpVersion: 'HTTP/1.0' | 'HTTP/1.1';
  connection: 'close' | 'keep-alive';
  nmeaIntervalSec: number;
  nmeaJitterSec: number;
  hdopMin: number;
  hdopMax: number;
  satsMin: number;
  satsMax: number;
  sendGsa: boolean;
  sendRmc: boolean;
  initialDelayMs: number;
  motion: 'static' | 'rover';
  receiverTypeAlias: string;
  enabled: boolean;
  builtin: boolean;
  updatedAt?: string | null;
}

export interface DeviceProfileInput {
  code: string;
  name: string;
  vendor?: string;
  versionTemplate: DeviceVersionTemplate;
  ntripVersion?: 'v1' | 'v2';
  httpVersion?: 'HTTP/1.0' | 'HTTP/1.1';
  connection?: 'close' | 'keep-alive';
  nmeaIntervalSec?: number;
  nmeaJitterSec?: number;
  hdopMin?: number;
  hdopMax?: number;
  satsMin?: number;
  satsMax?: number;
  sendGsa?: boolean;
  sendRmc?: boolean;
  initialDelayMs?: number;
  motion?: 'static' | 'rover';
  receiverTypeAlias?: string;
  enabled?: boolean;
}

export const DEFAULT_DEVICE_PROFILE_CODE = 'gnss_internet_radio';
export const MAX_USER_AGENT_LEN = 255;
const RNG_FALLBACK_SEED = 0x9e3779b97f4a7c15n;
const MASK64 = (1n << 64n) - 1n;

export function mapDeviceProfileRow(row: any): DeviceProfile {
  return {
    id: Number(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    vendor: String(row.vendor ?? ''),
    versionTemplate: String(row.version_template ?? 'major.minor.patch') as DeviceVersionTemplate,
    ntripVersion: String(row.ntrip_version ?? 'v2') === 'v1' ? 'v1' : 'v2',
    httpVersion: String(row.http_version ?? '') === 'HTTP/1.0' ? 'HTTP/1.0' : 'HTTP/1.1',
    connection: String(row.connection ?? '') === 'keep-alive' ? 'keep-alive' : 'close',
    nmeaIntervalSec: Number(row.nmea_interval_sec ?? 10),
    nmeaJitterSec: Number(row.nmea_jitter_sec ?? 0),
    hdopMin: Number(row.hdop_min ?? 0.8),
    hdopMax: Number(row.hdop_max ?? 1.2),
    satsMin: Number(row.sats_min ?? 10),
    satsMax: Number(row.sats_max ?? 14),
    sendGsa: Boolean(row.send_gsa),
    sendRmc: Boolean(row.send_rmc),
    initialDelayMs: Number(row.initial_delay_ms ?? 0),
    motion: String(row.motion ?? 'static') === 'rover' ? 'rover' : 'static',
    receiverTypeAlias: String(row.receiver_type_alias ?? ''),
    enabled: Boolean(row.enabled),
    builtin: Boolean(row.builtin),
    updatedAt: row.updated_at ?? null
  };
}

export async function listDeviceProfiles(includeDisabled = false): Promise<DeviceProfile[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM device_profiles ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY builtin DESC, id ASC`
  );
  return rows.map((row) => mapDeviceProfileRow(row));
}

export async function getDeviceProfile(id: number): Promise<DeviceProfile | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM device_profiles WHERE id = ?', [id]);
  return rows[0] ? mapDeviceProfileRow(rows[0]) : null;
}

export async function getDeviceProfileByCode(code: string): Promise<DeviceProfile | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM device_profiles WHERE code = ?', [
    code.trim().toLowerCase()
  ]);
  return rows[0] ? mapDeviceProfileRow(rows[0]) : null;
}

export function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & MASK64;
  }
  return hash;
}

/** Cùng công thức với Go deviceprofile.Seed để version ổn định qua restart. */
export function deviceSeed(code: string, targetId: number | bigint, role: DeviceRole): bigint {
  let seed = fnv1a64(code.trim().toLowerCase());
  seed ^= BigInt(targetId) & MASK64;
  seed ^= fnv1a64(role);
  seed &= MASK64;
  return seed === 0n ? RNG_FALLBACK_SEED : seed;
}

class XorShift64 {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed === 0n ? RNG_FALLBACK_SEED : seed;
  }

  next(): bigint {
    let x = this.state;
    x ^= (x << 13n) & MASK64;
    x ^= x >> 7n;
    x ^= (x << 17n) & MASK64;
    this.state = x & MASK64;
    return this.state;
  }

  intn(n: number): number {
    if (n <= 0) return 0;
    return Number(this.next() % BigInt(n));
  }
}

export function deviceVersion(
  profile: Pick<DeviceProfile, 'versionTemplate'>,
  seed: bigint
): string {
  const rng = new XorShift64(seed);
  switch (profile.versionTemplate) {
    case 'major.minor.patch': {
      const major = rng.intn(8) + 1;
      const minor = rng.intn(10);
      const patch = rng.intn(20);
      return `${major}.${minor}.${patch}`;
    }
    case 'vmajor.minor.patch': {
      const major = rng.intn(4) + 1;
      const minor = rng.intn(30);
      const patch = rng.intn(10);
      return `v${major}.${minor}.${patch}`;
    }
    case 'major.minor': {
      const major = rng.intn(8) + 3;
      const minor = rng.intn(99) + 1;
      return `${major}.${minor}`;
    }
    case 'major.minor.patch.date': {
      const major = rng.intn(5) + 5;
      const minor = rng.intn(10);
      const patch = rng.intn(5);
      const year = 2023 + rng.intn(2);
      const month = rng.intn(12) + 1;
      const day = rng.intn(28) + 1;
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${major}.${minor}.${patch}.${year}${mm}${dd}`;
    }
    default:
      return '1.0.0';
  }
}

export function deviceUserAgent(
  profile: Pick<DeviceProfile, 'code' | 'name' | 'versionTemplate'>,
  prefix: string,
  role: DeviceRole,
  targetId: number
): string {
  const seed = deviceSeed(profile.code, targetId, role);
  const base = `${profile.name.trim()}/${deviceVersion(profile, seed)}`;
  const cleanPrefix = prefix.trim();
  const value = cleanPrefix ? `${cleanPrefix} ${base}` : base;
  return value.slice(0, MAX_USER_AGENT_LEN);
}

export function previewDeviceUserAgent(
  profile: DeviceProfile,
  prefix: string,
  role: DeviceRole,
  targetId: number
): { userAgent: string; version: string; seed: string } {
  const seed = deviceSeed(profile.code, targetId, role);
  return {
    userAgent: deviceUserAgent(profile, prefix, role, targetId),
    version: deviceVersion(profile, seed),
    seed: seed.toString(16)
  };
}

export async function loadSettingProfileCode(key: string): Promise<string> {
  const rows = await query<RowDataPacket[]>(
    'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  const raw = rows[0]?.setting_value;
  if (!raw) return DEFAULT_DEVICE_PROFILE_CODE;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed?.code === 'string' && parsed.code.trim()
      ? parsed.code.trim()
      : DEFAULT_DEVICE_PROFILE_CODE;
  } catch {
    return DEFAULT_DEVICE_PROFILE_CODE;
  }
}
