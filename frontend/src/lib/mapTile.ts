import type { MapConfig, MapMode, MapModeConfig } from '../types';

export function modeConfig(config: MapConfig, mode: MapMode): MapModeConfig {
  return config.modes[mode] ?? config.modes.streets;
}

export function tileUrlForMode(config: MapConfig, mode: MapMode): string {
  return modeConfig(config, mode).tileUrl;
}

export function attributionForMode(config: MapConfig, mode: MapMode): string {
  return modeConfig(config, mode).attribution || config.attribution;
}

export function maxZoomForMode(config: MapConfig, mode: MapMode): number {
  return modeConfig(config, mode).maxZoom ?? config.maxZoom;
}

export function maxNativeZoomForMode(config: MapConfig, mode: MapMode): number {
  return modeConfig(config, mode).maxNativeZoom ?? config.maxNativeZoom ?? maxZoomForMode(config, mode);
}

export function isSafeTileUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/api/map/tiles')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateMapConfigShape(config: MapConfig | undefined | null): boolean {
  if (!config) return false;
  if (config.tileMode !== 'proxy' && config.tileMode !== 'direct') return false;
  if (!isSafeTileUrl(config.tileUrl)) return false;
  return (['streets', 'satellite', 'terrain'] as MapMode[]).every((mode) =>
    isSafeTileUrl(config.modes?.[mode]?.tileUrl ?? '')
  );
}
