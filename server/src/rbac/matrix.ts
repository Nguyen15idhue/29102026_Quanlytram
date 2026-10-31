import type { Scope } from './scope';

export function roleMatrix(role: string, code: string): Scope {
  if (role === 'super_admin') return 'all';
  if (role === 'admin') {
    if (code === 'roles.view') return 'all';
    if (code.startsWith('roles.')) return 'none';
    if (code.startsWith('settings.')) return 'none';
    if (code === 'system_health.view') return 'none';
    if (code.startsWith('web_users.')) return 'subtree';
    if (code.startsWith('alerts.')) return 'subtree';
    if (code.startsWith('quality.')) return 'subtree';
    if (code === 'audit.view') return 'subtree';
    if (
      code.endsWith('.view') ||
      code.endsWith('.add') ||
      code.endsWith('.edit') ||
      code.endsWith('.delete')
    ) {
      return 'subtree';
    }
    return 'none';
  }
  if (role === 'user') {
    if (code === 'stations.view' || code === 'relay.view') return 'tenant';
    if (code.startsWith('mountpoints.')) return 'own';
    if (code.startsWith('ntrip_accounts.')) return 'own';
    if (code === 'alerts.view' || code === 'quality.view') return 'own';
    return 'none';
  }
  return 'none';
}
