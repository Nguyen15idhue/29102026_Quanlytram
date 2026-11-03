import http from 'node:http';
import { app } from './app';
import { config } from './config';
import { closePool } from './db/pool';
import { closeRuntimePool } from './db/runtimePool';
import { startMaintenanceScheduler } from './lib/maintenance';
import { purgeOrphanQualityAlerts } from './lib/qualityAlerts';
import { initRealtime } from './realtime/socket';

const server = http.createServer(app);
const realtime = initRealtime(server);
startMaintenanceScheduler();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on :${config.port}`);
  void purgeOrphanQualityAlerts()
    .then((count) => {
      if (count > 0) console.log(`[quality] đã resolve ${count} cảnh báo mồ côi`);
    })
    .catch((err) => console.error('[quality] purge alerts failed', err instanceof Error ? err.message : err));
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received, shutting down`);
  try {
    await realtime.stop();
  } catch {
    // ignore realtime shutdown errors
  }
  server.close(async () => {
    try {
      await closePool();
      await closeRuntimePool();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection', err instanceof Error ? err.message : err);
});
