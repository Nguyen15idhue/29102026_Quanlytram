import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const PAGE_SIZES = [10, 20, 50];

export function useListParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const requestedSize = Number(params.get('pageSize') ?? 10);
  const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : 10;
  const q = params.get('q') ?? '';

  const update = useCallback(
    (next: Record<string, string | number | null>) => {
      const copy = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') copy.delete(key);
        else copy.set(key, String(value));
      }
      setParams(copy, { replace: true });
    },
    [params, setParams]
  );

  const setPage = useCallback((value: number) => update({ page: value }), [update]);
  const setPageSize = useCallback(
    (value: number) => update({ pageSize: value, page: 1 }),
    [update]
  );
  const setQ = useCallback((value: string) => update({ q: value, page: 1 }), [update]);
  const getParam = useCallback((key: string) => params.get(key) ?? '', [params]);
  const setParam = useCallback(
    (key: string, value: string | number | null) => update({ [key]: value, page: 1 }),
    [update]
  );

  return { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam };
}
