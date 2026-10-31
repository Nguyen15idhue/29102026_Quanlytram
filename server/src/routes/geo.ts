import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { requireAuth } from '../middleware/auth';

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
