import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@sanctuary/db';
import { duels, globalStatistics, poems, topicStatistics, topics, votes } from '../db/schema';

const MAX_READING_TIME_MS = 10 * 60 * 1000; // 10 minutes

const voteSchema = z.object({
  duelId: z.string().min(1),
  selectedPoemId: z.string().min(1),
  readingTimeMs: z.number().int().positive(),
});

export function createVotesRouter(db: Db) {
  const router = new Hono();

  // POST /votes
  router.post('/', zValidator('json', voteSchema), async (c) => {
    const { duelId, selectedPoemId, readingTimeMs: rawReadingTimeMs } = c.req.valid('json');

    // Clamp reading time to 10 minutes maximum
    const readingTimeMs = Math.min(rawReadingTimeMs, MAX_READING_TIME_MS);

    // Verify duel exists
    const [duel] = await db
      .select({
        id: duels.id,
        poemAId: duels.poemAId,
        poemBId: duels.poemBId,
        topicId: duels.topicId,
      })
      .from(duels)
      .where(eq(duels.id, duelId))
      .limit(1);
    if (!duel) return c.json({ error: 'Duel not found' }, 404);

    // Verify selected poem belongs to this duel
    if (selectedPoemId !== duel.poemAId && selectedPoemId !== duel.poemBId) {
      return c.json({ error: 'Selected poem does not belong to this duel' }, 400);
    }

    // Determine if the selected poem is human
    const [poem] = await db.select().from(poems).where(eq(poems.id, selectedPoemId)).limit(1);
    const isHuman = poem.type === 'HUMAN';

    // Fetch topic label for topic_statistics (denormalised for display stability)
    const [topic] = await db
      .select({ label: topics.label })
      .from(topics)
      .where(eq(topics.id, duel.topicId))
      .limit(1);
    const topicLabel = topic?.label ?? duel.topicId;

    const humanIncrement = isHuman ? 1 : 0;
    const now = new Date().toISOString();

    // Atomic batch: insert vote + upsert global + upsert topic stats.
    // Using db.batch() instead of db.transaction() because the @libsql/client
    // local-mode interactive transaction opens a new connection internally,
    // which gets its own empty private in-memory database (file::memory:
    // per-connection semantics). db.batch() uses client.batch() which runs all
    // statements atomically on the same connection via a single BEGIN/COMMIT.
    await db.batch([
      db.insert(votes).values({
        duelId,
        selectedPoemId,
        isHuman,
        readingTimeMs,
      }),
      db
        .insert(globalStatistics)
        .values({
          id: 'global',
          totalVotes: 1,
          humanVotes: humanIncrement,
          decisionTimeSumMs: readingTimeMs,
          decisionTimeCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: globalStatistics.id,
          set: {
            totalVotes: sql`${globalStatistics.totalVotes} + 1`,
            humanVotes: sql`${globalStatistics.humanVotes} + ${humanIncrement}`,
            decisionTimeSumMs: sql`${globalStatistics.decisionTimeSumMs} + ${readingTimeMs}`,
            decisionTimeCount: sql`${globalStatistics.decisionTimeCount} + 1`,
            updatedAt: now,
          },
        }),
      db
        .insert(topicStatistics)
        .values({
          topicId: duel.topicId,
          topicLabel,
          totalVotes: 1,
          humanVotes: humanIncrement,
          decisionTimeSumMs: readingTimeMs,
          decisionTimeCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: topicStatistics.topicId,
          set: {
            totalVotes: sql`${topicStatistics.totalVotes} + 1`,
            humanVotes: sql`${topicStatistics.humanVotes} + ${humanIncrement}`,
            decisionTimeSumMs: sql`${topicStatistics.decisionTimeSumMs} + ${readingTimeMs}`,
            decisionTimeCount: sql`${topicStatistics.decisionTimeCount} + 1`,
            updatedAt: now,
          },
        }),
    ]);

    return c.json({ success: true, isHuman });
  });

  return router;
}
