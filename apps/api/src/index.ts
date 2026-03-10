import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { db } from './db/client';
import { ensureDbReady, getDbReadinessSnapshot, startDbWarmup } from './db/readiness';
import { ApiError, ServiceUnavailableError } from './errors';
import { createDuelsRouter } from './routes/duels';
import { createTopicsRouter } from './routes/topics';
import { votesRouter } from './routes/votes';

// Read version from root package.json at startup; degrades gracefully to "unknown".
let appVersion = 'unknown';
try {
  const pkgText = await Bun.file(new URL('../../../package.json', import.meta.url)).text();
  const pkg = JSON.parse(pkgText) as { version?: unknown };
  if (typeof pkg.version === 'string' && /^\d+\.\d+$/.test(pkg.version)) {
    appVersion = pkg.version;
  }
} catch {
  // version stays 'unknown' — root package.json not available in this environment
}

const app = new Hono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

startDbWarmup().catch((error) => {
  console.error('DB warm-up failed during bootstrap:', error);
});

app.get('/health', (c) => c.json({ status: 'ok', version: appVersion }));

app.get('/ready', async (c) => {
  try {
    await ensureDbReady();
    return c.json({ status: 'ok', ready: true });
  } catch {
    const snapshot = getDbReadinessSnapshot();
    console.error(
      `DB readiness check failed (${snapshot.status}): ${snapshot.lastError ?? 'unknown error'}`,
    );
    return c.json(
      {
        status: 'degraded',
        ready: false,
        code: 'SERVICE_UNAVAILABLE',
        reason: snapshot.status,
        error: 'Database is not ready',
      },
      503,
    );
  }
});

app.use('/api/v1/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return next();
  }

  try {
    await ensureDbReady();
  } catch {
    const snapshot = getDbReadinessSnapshot();
    console.error(
      `DB readiness middleware failed (${snapshot.status}): ${snapshot.lastError ?? 'unknown error'}`,
    );
    throw new ServiceUnavailableError('Database is not ready');
  }

  await next();
});

app.route('/api/v1/duels', createDuelsRouter(db));
app.route('/api/v1/topics', createTopicsRouter(db));
app.route('/api/v1/votes', votesRouter);

// Global error handler — catches ApiError subclasses thrown inside route handlers
// and formats them as stable { error, code } JSON payloads.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as 400 | 404 | 500 | 503);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
});

const port = Number(process.env.PORT ?? 4000);
console.log(`Sanctuary API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
