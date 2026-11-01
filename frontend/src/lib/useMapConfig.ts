import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { MapConfig } from '../types';

export const MAP_CONFIG_QUERY_KEY = ['map-config'] as const;

export function useMapConfig() {
  return useQuery({
    queryKey: MAP_CONFIG_QUERY_KEY,
    queryFn: () => apiFetch<{ config: MapConfig }>('/api/map/config'),
    staleTime: 5 * 60_000
  });
}
