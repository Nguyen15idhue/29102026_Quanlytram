import type { Scope } from './scope';

export function roleMatrix(role: string, code: string): Scope {
  if (role === 'super_admin') return 'all';
  if (role === 'admin') {
    if (code.startsWith('companies.')) return 'none';
    if (code === 'roles.view') return 'all';
    if (code.startsWith('roles.')) return 'none';
    if (code.startsWith('settings.')) return 'none';
    if (code === 'system_health.view') return 'none';
    if (code.startsWith('system_ops.')) return 'none';
    if (code === 'caster.view') return 'all';
    if (code.startsWith('caster.')) return 'none';
    if (code.endsWith('.view') || code === 'audit.view') return 'tenant';
    if (
      code.endsWith('.add') ||
      code.endsWith('.edit') ||
      code.endsWith('.delete') ||
      code.endsWith('.ack')
    ) {
      return 'tenant';
    }
    return 'none';
  }
  if (role === 'user') {
    if (code === 'stations.view' || code === 'relay.view') return 'tenant';
    if (code.startsWith('mountpoints.')) return 'own';
    if (code.startsWith('ntrip_accounts.')) return 'own';
    if (code === 'alerts.view' || code === 'quality.view') return 'own';
    if (code.startsWith('system_ops.')) return 'none';
    return 'none';
  }
  return 'none';
}
