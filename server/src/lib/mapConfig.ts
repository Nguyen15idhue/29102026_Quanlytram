import { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { query } from '../db/pool';

export type MapMode = 'streets' | 'satellite' | 'terrain';
export type TileMode = 'proxy' | 'direct';

export interface MapModeConfig {
  provider?: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom?: number;
  retina?: boolean;
  subdomains?: string[];
}

export interface MapConfig {
  version: number;
  provider: string;
  tileMode: TileMode;
  tileUrl: string;
  attribution: string;
  subdomains: string[];
  maxZoom: number;
  maxNativeZoom: number;
  retina: boolean;
  center: { lat: number; lng: number };
  zoom: number;
  modes: Record<MapMode, MapModeConfig>;
}

export interface TileProviderDefinition {
  mode: MapMode;
  provider: string;
  template: string;
  fallbackTemplate?: string;
  attribution: string;
  maxZoom: number;
}

export const MAP_MODES: MapMode[] = ['streets', 'satellite', 'terrain'];

export const MODE_PROVIDERS: Record<MapMode, TileProviderDefinition> = {
  streets: {
    mode: 'streets',
    provider: 'osm-de',
    template: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    fallbackTemplate: 'https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  },
  satellite: {
    mode: 'satellite',
    provider: 'esri',
    template:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 19
  },
  terrain: {
    mode: 'terrain',
    provider: 'opentopomap',
    template: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap',
    maxZoom: 17
  }
};

export const ALLOWED_TILE_HOSTS = new Set<string>(
  MAP_MODES.flatMap((mode) => {
    const definition = MODE_PROVIDERS[mode];
    const hosts = [new URL(definition.template).hostname];
    if (definition.fallbackTemplate) {
      hosts.push(new URL(definition.fallbackTemplate).hostname);
    }
    return hosts;
  })
);

const SECRET_KEY = /key|token|secret|pass|passwd|authorization|cookie/i;

export const DEFAULT_MAP_CONFIG: MapConfig = {
  version: 1,
  provider: 'osm-de',
  tileMode: 'proxy',
  tileUrl: '/api/map/tiles/{z}/{x}/{y}',
  attribution: '© OpenStreetMap contributors',
  subdomains: [],
  maxZoom: 19,
  maxNativeZoom: 19,
  retina: false,
  center: { lat: 16.0, lng: 106.0 },
  zoom: 6,
  modes: {
    streets: {
      provider: 'osm-de',
      tileUrl: '/api/map/tiles/{z}/{x}/{y}?mode=streets',
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    },
    satellite: {
      provider: 'esri',
      tileUrl: '/api/map/tiles/{z}/{x}/{y}?mode=satellite',
      attribution: '© Esri',
      maxZoom: 19
    },
    terrain: {
      provider: 'opentopomap',
      tileUrl: '/api/map/tiles/{z}/{x}/{y}?mode=terrain',
      attribution: '© OpenTopoMap',
      maxZoom: 17
    }
  }
};

const modeSchema = z
  .object({
    provider: z.string().min(1).max(64).optional(),
    tileUrl: z.string().min(1).max(1024),
    attribution: z.string().max(512),
    maxZoom: z.number().int().min(0).max(22),
    maxNativeZoom: z.number().int().min(0).max(22).optional(),
    retina: z.boolean().optional(),
    subdomains: z.array(z.string().max(16)).max(10).optional()
  })
  .strict();

const configSchema = z
  .object({
    version: z.number().int().min(1).max(1000),
    provider: z.string().min(1).max(64),
    tileMode: z.enum(['proxy', 'direct']),
    tileUrl: z.string().min(1).max(1024),
    attribution: z.string().max(512),
    subdomains: z.array(z.string().max(16)).max(10),
    maxZoom: z.number().int().min(0).max(22),
    maxNativeZoom: z.number().int().min(0).max(22),
    retina: z.boolean(),
    center: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict(),
    zoom: z.number().int().min(0).max(22),
    modes: z.object({ streets: modeSchema, satellite: modeSchema, terrain: modeSchema }).strict()
  })
  .strict();

function isAllowedHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return ALLOWED_TILE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function stripSecret(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecret);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      output[key] = stripSecret(item);
    }
    return output;
  }
  return value;
}

export function mergeMapConfig(
  base: MapConfig,
  patch: Partial<MapConfig> | null | undefined
): MapConfig {
  if (!patch || typeof patch !== 'object') return structuredClone(base);
  const merged: MapConfig = {
    ...base,
    ...stripSecret(patch) as Partial<MapConfig>,
    center: {
      ...base.center,
      ...(patch.center && typeof patch.center === 'object' ? patch.center : {})
    },
    modes: {
      streets: { ...base.modes.streets, ...(patch.modes?.streets ?? {}) },
      satellite: { ...base.modes.satellite, ...(patch.modes?.satellite ?? {}) },
      terrain: { ...base.modes.terrain, ...(patch.modes?.terrain ?? {}) }
    }
  };
  merged.subdomains = Array.isArray(patch.subdomains)
    ? patch.subdomains
    : base.subdomains;
  return merged;
}

function checkUrlSafety(config: MapConfig): MapConfig {
  if (config.tileMode === 'proxy') {
    if (!config.tileUrl.startsWith('/api/map/tiles')) {
      throw new Error('tileUrl proxy phải trỏ tới /api/map/tiles');
    }
    for (const mode of MAP_MODES) {
      if (!config.modes[mode].tileUrl.startsWith('/api/map/tiles')) {
        throw new Error(`tileUrl mode ${mode} phải trỏ tới /api/map/tiles`);
      }
    }
  } else {
    if (!isAllowedHttpUrl(config.tileUrl)) {
      throw new Error('tileUrl nằm ngoài allowlist');
    }
    for (const mode of MAP_MODES) {
      if (!isAllowedHttpUrl(config.modes[mode].tileUrl)) {
        throw new Error(`tileUrl mode ${mode} nằm ngoài allowlist`);
      }
    }
  }
  return config;
}

export function normalizeMapConfig(raw: unknown): MapConfig {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const merged = mergeMapConfig(
    DEFAULT_MAP_CONFIG,
    parsed && typeof parsed === 'object' ? (parsed as Partial<MapConfig>) : null
  );
  const result = configSchema.safeParse(merged);
  if (!result.success) return structuredClone(DEFAULT_MAP_CONFIG);
  return result.data as MapConfig;
}

export function validateMapConfigInput(raw: unknown): MapConfig {
  const merged = mergeMapConfig(
    DEFAULT_MAP_CONFIG,
    raw && typeof raw === 'object' ? (raw as Partial<MapConfig>) : null
  );
  const parsed = configSchema.parse(merged) as MapConfig;
  return checkUrlSafety(parsed);
}

export async function getMapConfig(): Promise<MapConfig> {
  const rows = await query<RowDataPacket[]>(
    'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
    ['map.config']
  );
  return normalizeMapConfig(rows[0]?.setting_value ?? null);
}

export async function readRawMapConfig(): Promise<unknown> {
  const rows = await query<RowDataPacket[]>(
    'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
    ['map.config']
  );
  return rows[0]?.setting_value ?? null;
}

export function sanitizeMapConfig(config: MapConfig): MapConfig {
  return stripSecret(structuredClone(config)) as MapConfig;
}

export function isAllowedTileHost(hostname: string): boolean {
  return ALLOWED_TILE_HOSTS.has(hostname);
}

export function isAllowedTileUrl(value: string): boolean {
  return isAllowedHttpUrl(value);
}

function tileInt(value: unknown): number | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d+)(?:\.[A-Za-z0-9]+)?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

export function parseTileCoord(zRaw: unknown, xRaw: unknown, yRaw: unknown): {
  z: number;
  x: number;
  y: number;
} | null {
  const z = tileInt(zRaw);
  const x = tileInt(xRaw);
  const y = tileInt(yRaw);
  if (z === null || x === null || y === null) return null;
  if (z < 0 || z > 22) return null;
  const limit = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null;
  if (x >= limit || y >= limit) return null;
  return { z, x, y };
}

export function buildTileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

export function resolveModeProvider(mode: MapMode): TileProviderDefinition {
  return MODE_PROVIDERS[mode];
}

export function isMapMode(value: unknown): value is MapMode {
  return value === 'streets' || value === 'satellite' || value === 'terrain';
}
