import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
dotenv.config({ path: process.env.ENV_FILE || '../.env.local' });
dotenv.config();

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${name}`);
  return parsed;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: envInt('PORT', 4000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL || 'info',
  mysql: {
    host: env('MYSQL_HOST', '127.0.0.1'),
    port: envInt('MYSQL_PORT', 3306),
    adminDatabase: env('MYSQL_ADMIN_DATABASE', 'cors_admin'),
    runtimeDatabase: env('MYSQL_RUNTIME_DATABASE', 'cors_runtime'),
    appUser: env('MYSQL_APP_USER'),
    appPassword: env('MYSQL_APP_PASSWORD'),
    relayUser: env('MYSQL_RELAY_USER'),
    migratorUser: env('MYSQL_MIGRATOR_USER'),
    migratorPassword: env('MYSQL_MIGRATOR_PASSWORD')
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'cors_sid',
    ttlHours: envInt('SESSION_TTL_HOURS', 12),
    secure: (process.env.SESSION_COOKIE_SECURE || 'false') === 'true'
  },
  seed: {
    superadminPassword: env('SEED_SUPERADMIN_PASSWORD'),
    adminPassword: env('SEED_ADMIN_PASSWORD'),
    userPassword: env('SEED_USER_PASSWORD'),
    ntripPassword: env('SEED_NTRIP_PASSWORD')
  },
  security: {
    appEncKey: process.env.APP_ENC_KEY || '',
    internalHmacSecret: process.env.INTERNAL_HMAC_SECRET || '',
    goInternalUrl: process.env.GO_INTERNAL_URL || 'http://127.0.0.1:7080',
    internalTimeoutMs: envInt('INTERNAL_TIMEOUT_MS', 5000)
  },
  migrationsDir: process.env.MIGRATIONS_DIR || '../db/migrations',
  realtime: {
    pollMs: Math.max(500, envInt('REALTIME_POLL_MS', 1000))
  }
};
