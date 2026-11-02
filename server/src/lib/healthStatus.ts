export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown';

const MB = 1024 * 1024;

export const NODE_HEAP_WARN_BYTES = 400 * MB;
export const NODE_HEAP_ERROR_BYTES = 700 * MB;
export const NODE_RSS_WARN_PERCENT = 70;
export const NODE_RSS_ERROR_PERCENT = 85;

export function nodeHealthStatus(input: {
  heapUsedBytes: number;
  rssPercent: number;
  eventLoopLagMs: number;
}): HealthStatus {
  if (
    input.heapUsedBytes >= NODE_HEAP_ERROR_BYTES ||
    input.rssPercent >= NODE_RSS_ERROR_PERCENT ||
    input.eventLoopLagMs >= 1000
  ) {
    return 'error';
  }
  if (
    input.heapUsedBytes >= NODE_HEAP_WARN_BYTES ||
    input.rssPercent >= NODE_RSS_WARN_PERCENT ||
    input.eventLoopLagMs >= 200
  ) {
    return 'warn';
  }
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
