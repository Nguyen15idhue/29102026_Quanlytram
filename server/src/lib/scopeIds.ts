/**
 * Trả danh sách id theo scope. `own` chỉ chính actor, không mở rộng subtree.
 */
export function idsForScope(
  scope: string,
  actorId: number,
  subtreeIds: number[],
  tenantIds: number[]
): number[] {
  if (scope === 'tenant') return tenantIds;
  if (scope === 'own') return [actorId];
  return subtreeIds;
}
