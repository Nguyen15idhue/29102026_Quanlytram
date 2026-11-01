import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { adminPool } from './db/pool';
import { asyncHandler, errorHandler, notFound } from './lib/http';
import { authRouter } from './routes/auth';
import { stationsRouter } from './routes/stations';
import { mapRouter } from './routes/map';
import { geoRouter } from './routes/geo';
import { mountpointsRouter } from './routes/mountpoints';
import { webUsersRouter } from './routes/webUsers';
import { companiesRouter } from './routes/companies';
import { rolesRouter } from './routes/roles';
import { permissionsRouter } from './routes/permissions';
import { relayJobsRouter } from './routes/relayJobs';
import { ntripAccountsRouter } from './routes/ntripAccounts';
import { casterConnectionsRouter, casterRouter } from './routes/caster';
import { alertsRouter } from './routes/alerts';
import { historyRouter } from './routes/history';
import { snapshotRouter } from './routes/snapshot';
import { qualityRouter } from './routes/quality';
import { auditRouter } from './routes/audit';
import { dictionariesRouter } from './routes/dictionaries';
import { profileRouter } from './routes/profile';
import { systemRouter } from './routes/system';
import { opsRouter } from './routes/ops';

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.csrfToken'
    ],
    censor: '***'
  }
});

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, remoteAddress: req.remoteAddress };
      }
    }
  })
);
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.API_RATE_LIMIT ?? 300),
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 60_000,
    limit: Math.max(10, Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT || '10', 10) || 10),
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get(
  '/health',
  asyncHandler(async (_req, res) => {
    try {
      await adminPool.query('SELECT 1');
      const [rows] = await adminPool.query<any[]>(
        "SELECT MAX(version) AS version FROM schema_migrations WHERE scope = 'admin'"
      );
      const schemaVersion = Number(rows[0]?.version ?? 0);
      const healthy = schemaVersion >= 6;
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        db: 'ok',
        schemaVersion,
        time: new Date().toISOString()
      });
    } catch (err) {
      res.status(503).json({
        status: 'error',
        db: 'error',
        message: err instanceof Error ? err.message : 'unknown',
        time: new Date().toISOString()
      });
    }
  })
);

app.use('/api/auth', authRouter);
app.use('/api/stations', stationsRouter);
app.use('/api/map', mapRouter);
app.use('/api/geo', geoRouter);
app.use('/api/mountpoints', mountpointsRouter);
app.use('/api/web-users', webUsersRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/relay-jobs', relayJobsRouter);
app.use('/api/ntrip-accounts', ntripAccountsRouter);
app.use('/api/caster', casterRouter);
app.use('/api/connections', casterConnectionsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/history', historyRouter);
app.use('/api/snapshot', snapshotRouter);
app.use('/api', qualityRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/dictionaries', dictionariesRouter);
app.use('/api/profile', profileRouter);
app.use('/api/system', systemRouter);
app.use('/api/ops', opsRouter);

app.use(notFound);
app.use(errorHandler);
