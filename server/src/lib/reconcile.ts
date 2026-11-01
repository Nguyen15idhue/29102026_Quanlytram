import { callGoInternal } from './internalApi';

export interface ReconcileTargets {
  stationIds?: number[];
  mountpointIds?: number[];
  listenerIds?: number[];
  accountIds?: number[];
  probeIds?: number[];
  relayJobIds?: number[];
  caster?: boolean;
  probe?: boolean;
}

export interface ReconcileResult {
  ok: boolean;
  caster: 'ok' | 'failed' | 'skipped';
  relay: 'ok' | 'failed' | 'skipped';
  probe: 'ok' | 'failed' | 'skipped';
  errors: string[];
}

export async function reconcileAffected(
  targets: ReconcileTargets
): Promise<ReconcileResult> {
  const errors: string[] = [];
  const relayJobIds = [...new Set(targets.relayJobIds ?? [])].filter((id) => id > 0);
  const needsCaster =
    Boolean(targets.caster) ||
    (targets.stationIds?.length ?? 0) > 0 ||
    (targets.mountpointIds?.length ?? 0) > 0 ||
    (targets.listenerIds?.length ?? 0) > 0 ||
    (targets.accountIds?.length ?? 0) > 0;
  const needsProbe =
    Boolean(targets.probe) ||
    (targets.stationIds?.length ?? 0) > 0 ||
    (targets.probeIds?.length ?? 0) > 0;

  let caster: ReconcileResult['caster'] = 'skipped';
  if (needsCaster) {
    try {
      await callGoInternal('/internal/caster/reconcile', {});
      caster = 'ok';
    } catch (err) {
      caster = 'failed';
      errors.push(`caster: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  let relay: ReconcileResult['relay'] = 'skipped';
  if (relayJobIds.length > 0) {
    try {
      await callGoInternal('/internal/reconcile', { jobIds: relayJobIds });
      relay = 'ok';
    } catch (err) {
      relay = 'failed';
      errors.push(`relay: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  let probe: ReconcileResult['probe'] = 'skipped';
  if (needsProbe) {
    try {
      await callGoInternal('/internal/probe/reconcile', {});
      probe = 'ok';
    } catch (err) {
      probe = 'failed';
      errors.push(`probe: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return { ok: errors.length === 0, caster, relay, probe, errors };
}
