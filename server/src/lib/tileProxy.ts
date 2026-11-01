import {
  buildTileUrl,
  isAllowedTileHost,
  isMapMode,
  MapMode,
  resolveModeProvider
} from './mapConfig';

export const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const CACHE_LIMIT = 256;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, buffer: Buffer, contentType: string): void {
  cache.set(key, { buffer, contentType, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface TileFetchResult {
  buffer: Buffer;
  contentType: string;
  provider: string;
  finalUrl: string;
  status: 'ok' | 'fallback';
}

async function fetchFollowingRedirect(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !isAllowedTileHost(parsed.hostname)
    ) {
      return null;
    }
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'CORS-Manager/1.0 (tile proxy)' }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  return null;
}

async function fetchUpstream(url: string, provider: string): Promise<TileFetchResult | null> {
  try {
    const response = await fetchFollowingRedirect(url);
    if (!response || !response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return null;
    return {
      buffer,
      contentType,
      provider,
      finalUrl: response.url || url,
      status: 'ok'
    };
  } catch {
    return null;
  }
}

export async function fetchTile(
  mode: MapMode,
  z: number,
  x: number,
  y: number
): Promise<TileFetchResult | null> {
  if (!isMapMode(mode)) return null;
  const key = `${mode}:${z}/${x}/${y}`;
  const cached = cacheGet(key);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      provider: resolveModeProvider(mode).provider,
      finalUrl: '',
      status: 'ok'
    };
  }

  const definition = resolveModeProvider(mode);
  const primaryUrl = buildTileUrl(definition.template, z, x, y);
  const primary = await fetchUpstream(primaryUrl, definition.provider);
  if (primary) {
    cacheSet(key, primary.buffer, primary.contentType);
    return primary;
  }

  if (definition.fallbackTemplate) {
    const fallbackUrl = buildTileUrl(definition.fallbackTemplate, z, x, y);
    const fallback = await fetchUpstream(fallbackUrl, `${definition.provider}-fallback`);
    if (fallback) {
      cacheSet(key, fallback.buffer, fallback.contentType);
      return { ...fallback, status: 'fallback' };
    }
  }

  return null;
}

export async function testTileSource(
  mode: MapMode,
  z = 5,
  x = 24,
  y = 15
): Promise<{ ok: boolean; status: number; provider: string; ms: number; contentType?: string }> {
  const started = Date.now();
  const definition = resolveModeProvider(mode);
  const result = await fetchTile(mode, z, x, y);
  if (!result) {
    return {
      ok: false,
      status: 0,
      provider: definition.provider,
      ms: Date.now() - started
    };
  }
  return {
    ok: true,
    status: 200,
    provider: result.provider,
    ms: Date.now() - started,
    contentType: result.contentType
  };
}

export function clearTileCache(): void {
  cache.clear();
}

export function tileCacheSize(): number {
  return cache.size;
}
