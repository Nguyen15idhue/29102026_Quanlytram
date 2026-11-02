import os from 'node:os';
import { readFileSync } from 'node:fs';

let cache: { at: number; bytes: number } | null = null;

export function nodeMemoryLimitBytes(): number {
  const fromEnv = Number.parseInt(process.env.NODE_MEMORY_LIMIT_MB ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv * 1024 * 1024;
  }
  if (cache && Date.now() - cache.at < 60_000) {
    return cache.bytes;
  }
  let bytes = 0;
  for (const file of [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes'
  ]) {
    try {
      const raw = readFileSync(file, 'utf8').trim();
      if (!raw || raw === 'max') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < 2 ** 50) {
        bytes = value;
        break;
      }
    } catch {
      // cgroup file not available on this platform
    }
  }
  if (bytes <= 0) bytes = os.totalmem();
  cache = { at: Date.now(), bytes };
  return bytes;
}
