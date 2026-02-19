import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { duels, poems, votes } from '../db/schema';

export const duelsRouter = new Hono();

// GET /duels — paginated archive
duelsRouter.get('/', async (c) => {
  const page = Number(c.req.query('page') ?? 1);
  const limit = 12;
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: duels.id,
      topic: duels.topic,
      createdAt: duels.createdAt,
      totalVotes: sql<number>`count(${votes.id})`,
      humanVotes: sql<number>`sum(case when ${votes.isHuman} = 1 then 1 else 0 end)`,
    })
    .from(duels)
    .leftJoin(votes, eq(votes.duelId, duels.id))
    .groupBy(duels.id)
    .limit(limit)
    .offset(offset);

  const result = rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    createdAt: r.createdAt,
    humanWinRate: r.totalVotes > 0 ? Math.round((r.humanVotes / r.totalVotes) * 100) : 0,
    avgReadingTime: '3m 30s', // placeholder — can compute from poem length
  }));

  return c.json(result);
});

// GET /duels/today — today's featured duel (no author metadata)
duelsRouter.get('/today', async (c) => {
  // Use the most recently created duel as "today's"
  const [duel] = await db
    .select()
    .from(duels)
    .orderBy(sql`${duels.createdAt} desc`)
    .limit(1);

  if (!duel) return c.json({ error: 'No duels found' }, 404);

  return c.json(await anonymousDuel(duel.id));
});

// GET /duels/:id — single duel (anonymous)
duelsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [duel] = await db.select().from(duels).where(eq(duels.id, id)).limit(1);
  if (!duel) return c.json({ error: 'Duel not found' }, 404);
  return c.json(await anonymousDuel(id));
});

// GET /duels/:id/stats — stats + full author reveal
duelsRouter.get('/:id/stats', async (c) => {
  const id = c.req.param('id');

  const [duel] = await db.select().from(duels).where(eq(duels.id, id)).limit(1);
  if (!duel) return c.json({ error: 'Duel not found' }, 404);

  const [poemA, poemB] = await Promise.all([
    db.select().from(poems).where(eq(poems.id, duel.poemAId)).limit(1),
    db.select().from(poems).where(eq(poems.id, duel.poemBId)).limit(1),
  ]);

  const [stats] = await db
    .select({
      totalVotes: sql<number>`count(${votes.id})`,
      humanVotes: sql<number>`sum(case when ${votes.isHuman} = 1 then 1 else 0 end)`,
    })
    .from(votes)
    .where(eq(votes.duelId, id));

  const humanWinRate =
    stats.totalVotes > 0 ? Math.round((stats.humanVotes / stats.totalVotes) * 100) : 0;

  return c.json({
    humanWinRate,
    avgReadingTime: computeAvgReadingTime(poemA[0]?.content ?? '', poemB[0]?.content ?? ''),
    duel: {
      id: duel.id,
      topic: duel.topic,
      poemA: poemA[0],
      poemB: poemB[0],
    },
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function anonymousDuel(duelId: string) {
  const [duel] = await db.select().from(duels).where(eq(duels.id, duelId)).limit(1);

  const [poemA, poemB] = await Promise.all([
    db.select().from(poems).where(eq(poems.id, duel.poemAId)).limit(1),
    db.select().from(poems).where(eq(poems.id, duel.poemBId)).limit(1),
  ]);

  return {
    id: duel.id,
    topic: duel.topic,
    poemA: { id: poemA[0].id, title: poemA[0].title, content: poemA[0].content },
    poemB: { id: poemB[0].id, title: poemB[0].title, content: poemB[0].content },
  };
}

function computeAvgReadingTime(contentA: string, contentB: string): string {
  const words = (contentA + ' ' + contentB).split(/\s+/).length;
  const seconds = Math.round((words / 200) * 60); // ~200 wpm reading speed
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
