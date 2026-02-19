import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { duelsRouter } from './routes/duels';
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

app.route('/api/v1/duels', duelsRouter);
app.route('/api/v1/votes', votesRouter);

const port = Number(process.env.PORT ?? 4000);
console.log(`Sanctuary API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
