export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown';

export function nodeHealthStatus(input: {
  heapPercent: number;
  eventLoopLagMs: number;
}): HealthStatus {
  if (input.heapPercent >= 92 || input.eventLoopLagMs >= 1000) return 'error';
  if (input.heapPercent >= 80 || input.eventLoopLagMs >= 200) return 'warn';
  return 'ok';
}

export function hostHealthStatus(input: {
  memoryPercent: number;
  diskPercent: number | null;
}): HealthStatus {
  if (input.memoryPercent >= 97 || (input.diskPercent !== null && input.diskPercent >= 97)) {
    return 'error';
  }
  if (input.memoryPercent >= 90 || (input.diskPercent !== null && input.diskPercent >= 90)) {
    return 'warn';
  }
  return 'ok';
}

export function overallHealthStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('warn') || statuses.includes('unknown')) return 'warn';
  return 'ok';
}
