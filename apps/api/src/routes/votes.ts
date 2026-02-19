import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { duels, poems, votes } from '../db/schema';

export const votesRouter = new Hono();

const voteSchema = z.object({
  duelId: z.string().min(1),
  selectedPoemId: z.string().min(1),
});

// POST /votes
votesRouter.post('/', zValidator('json', voteSchema), async (c) => {
  const { duelId, selectedPoemId } = c.req.valid('json');

  // Verify duel exists
  const [duel] = await db.select().from(duels).where(eq(duels.id, duelId)).limit(1);
  if (!duel) return c.json({ error: 'Duel not found' }, 404);

  // Verify selected poem belongs to this duel
  if (selectedPoemId !== duel.poemAId && selectedPoemId !== duel.poemBId) {
    return c.json({ error: 'Selected poem does not belong to this duel' }, 400);
  }

  // Determine if the selected poem is human
  const [poem] = await db.select().from(poems).where(eq(poems.id, selectedPoemId)).limit(1);
  const isHuman = poem.type === 'HUMAN';

  await db.insert(votes).values({
    duelId,
    selectedPoemId,
    isHuman,
  });

  return c.json({ success: true, isHuman });
});
