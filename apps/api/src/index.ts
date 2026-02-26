import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { db } from './db/client';
import { ApiError } from './errors';
import { createDuelsRouter } from './routes/duels';
import { createTopicsRouter } from './routes/topics';
import { votesRouter } from './routes/votes';

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

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/v1/duels', createDuelsRouter(db));
app.route('/api/v1/topics', createTopicsRouter(db));
app.route('/api/v1/votes', votesRouter);

// Global error handler — catches ApiError subclasses thrown inside route handlers
// and formats them as stable { error, code } JSON payloads.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as 400 | 404 | 500);
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
