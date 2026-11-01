import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';

export const geoRouter = Router();
geoRouter.use(requireAuth);

interface GeoResult {
  province: string;
  ward: string;
  addressDetail: string;
  source: 'geoapify' | 'nominatim' | 'fallback';
}

async function nominatim(lat: number, lon: number): Promise<GeoResult | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('accept-language', 'vi');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'CORS-Manager/1.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    const address = data?.address ?? {};
    return {
      province: String(address.state ?? address.city ?? address.province ?? ''),
      ward: String(
        address.suburb ?? address.ward ?? address.city_district ?? address.county ?? ''
      ),
      addressDetail: String(
        address.road
          ? `${address.house_number ? `${address.house_number} ` : ''}${address.road}`
          : data?.display_name ?? ''
      ),
      source: 'nominatim'
    };
  } catch {
    return null;
  }
}

const cache = new Map<string, { expiresAt: number; value: GeoResult }>();
const CACHE_MS = 60 * 60 * 1000;

geoRouter.get(
  '/reverse',
  asyncHandler(async (req, res) => {
    const { lat, lon } = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180)
      })
      .parse(req.query);
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ item: cached.value });
      return;
    }

    let value: GeoResult = {
      province: '',
      ward: '',
      addressDetail: '',
      source: 'fallback'
    };
    const apiKey = process.env.GEOAPIFY_API_KEY ?? '';
    if (apiKey) {
      try {
        const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lon));
        url.searchParams.set('lang', 'vi');
        url.searchParams.set('apiKey', apiKey);
        const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (response.ok) {
          const data = (await response.json()) as any;
          const properties = data?.features?.[0]?.properties ?? {};
          value = {
            province: String(properties.state ?? properties.city ?? ''),
            ward: String(properties.suburb ?? properties.district ?? properties.county ?? ''),
            addressDetail: String(
              properties.address_line1 ??
                [properties.street, properties.housenumber].filter(Boolean).join(' ')
            ),
            source: 'geoapify'
          };
        }
      } catch {
        value.source = 'fallback';
      }
    }
    if (!value.province && !value.ward && !value.addressDetail) {
      const fallback = await nominatim(lat, lon);
      if (fallback) value = fallback;
    }
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
    res.json({ item: value });
  })
);

interface GeoSearchItem {
  label: string;
  lat: number;
  lon: number;
}

const searchCache = new Map<string, { expiresAt: number; items: GeoSearchItem[] }>();
const SEARCH_CACHE_MS = 5 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 100;

geoRouter.get(
  '/search',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const { q, limit } = z
      .object({
        q: z.string().trim().min(3).max(200),
        limit: z.coerce.number().int().min(1).max(10).default(5)
      })
      .parse(req.query);

    const cacheKey = `${q.toLowerCase()}|${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ items: cached.items });
      return;
    }

    const apiKey = process.env.GEOAPIFY_API_KEY ?? '';
    if (!apiKey) {
      res.json({ items: [], warning: 'missing_key' });
      return;
    }

    let items: GeoSearchItem[] = [];
    try {
      const url = new URL('https://api.geoapify.com/v1/geocode/search');
      url.searchParams.set('text', q);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('lang', 'vi');
      url.searchParams.set('apiKey', apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        res.json({ items: [], warning: 'provider_error' });
        return;
      }
      const data = (await response.json()) as any;
      items = (data?.features ?? [])
        .map((feature: any) => {
          const properties = feature?.properties ?? {};
          const lat = Number(properties.lat ?? feature?.geometry?.coordinates?.[1]);
          const lon = Number(properties.lon ?? feature?.geometry?.coordinates?.[0]);
          const label = String(
            properties.formatted ??
              [properties.name, properties.city, properties.country].filter(Boolean).join(', ')
          );
          return { label, lat, lon };
        })
        .filter(
          (item: GeoSearchItem) =>
            item.label &&
            Number.isFinite(item.lat) &&
            Number.isFinite(item.lon) &&
            item.lat >= -90 &&
            item.lat <= 90 &&
            item.lon >= -180 &&
            item.lon <= 180
        );
    } catch {
      res.json({ items: [], warning: 'provider_error' });
      return;
    }

    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_MS, items });
    while (searchCache.size > SEARCH_CACHE_LIMIT) {
      const oldest = searchCache.keys().next().value;
      if (oldest === undefined) break;
      searchCache.delete(oldest);
    }
    res.json({ items });
  })
);
