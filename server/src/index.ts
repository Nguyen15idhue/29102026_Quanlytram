import { app } from './app';
import { config } from './config';
import { closePool } from './db/pool';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on :${config.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(async () => {
    try {
      await closePool();
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
