export const SOFT_DELETE_KEY_SUFFIX = '#deleted:';

// SQL fragment: append the row id to the three unique keys at soft-delete time
// so the original keys are free for reuse; history keeps the zombie keys.
export const TOMBSTONE_KEY_SQL = [
  `external_key = CONCAT(COALESCE(external_key, ''), '${SOFT_DELETE_KEY_SUFFIX}', id)`,
  `upstream_key = CONCAT(COALESCE(upstream_key, ''), '${SOFT_DELETE_KEY_SUFFIX}', id)`,
  `downstream_key = CONCAT(COALESCE(downstream_key, ''), '${SOFT_DELETE_KEY_SUFFIX}', id)`
].join(', ');

export function tombstoneExternalKey(key: string | null, id: number): string {
  return `${key ?? ''}${SOFT_DELETE_KEY_SUFFIX}${id}`;
}
