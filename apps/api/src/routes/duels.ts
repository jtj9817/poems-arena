import { Hono } from 'hono';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@sanctuary/db';
import { duels, featuredDuels, poems, scrapeSources, topics, votes } from '../db/schema';
import {
  ApiError,
  DuelNotFoundError,
  EndpointNotFoundError,
  InvalidPageError,
  InvalidSeedError,
  MissingSeedError,
} from '../errors';
import { buildSeedPivot } from './seed-pivot';

export function createDuelsRouter(db: Db) {
  const router = new Hono();

  // GET /duels — paginated archive with topicMeta; supports seed, sort, page, and topic_id params
  router.get('/', async (c) => {
    const rawPage = c.req.query('page');
    const page = parsePage(rawPage);
    const topicId = c.req.query('topic_id');
    const rawSeed = c.req.query('seed');
    const sort = c.req.query('sort');
    const limit = 12;
    const offset = (page - 1) * limit;

    // Determine ordering mode: sort=recent bypasses seed requirement; otherwise seed is required.
    const useRecentSort = sort === 'recent';
    let seedPivot: string | null = null;

    if (!useRecentSort) {
      if (rawSeed === undefined) {
        throw new MissingSeedError();
      }
      const n = Number(rawSeed);
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new InvalidSeedError(
          `Invalid seed value: "${rawSeed}" — must be a non-negative safe integer`,
        );
      }
      seedPivot = buildSeedPivot(n);
    }

    const baseQuery = db
      .select({
        id: duels.id,
        topic: duels.topic,
        topicId: duels.topicId,
        topicLabel: topics.label,
        createdAt: duels.createdAt,
        poemAId: duels.poemAId,
        poemBId: duels.poemBId,
      })
      .from(duels)
      .leftJoin(topics, eq(duels.topicId, topics.id))
      .where(topicId !== undefined ? eq(duels.topicId, topicId) : undefined);

    const rows = await (
      useRecentSort
        ? baseQuery.orderBy(desc(duels.createdAt))
        : baseQuery.orderBy(
            sql`CASE WHEN ${duels.id} >= ${seedPivot} THEN 0 ELSE 1 END`,
            asc(duels.id),
          )
    )
      .limit(limit)
      .offset(offset);

    const duelIds = rows.map((r) => r.id);
    const poemIds = rows.flatMap((r) => [r.poemAId, r.poemBId]);

    const [voteStats, poemContents] = await Promise.all([
      duelIds.length > 0
        ? db
            .select({
              duelId: votes.duelId,
              totalVotes: sql<number>`count(${votes.id})`,
              humanVotes: sql<number>`sum(case when ${votes.isHuman} = 1 then 1 else 0 end)`,
            })
            .from(votes)
            .where(inArray(votes.duelId, duelIds))
            .groupBy(votes.duelId)
        : Promise.resolve([]),
      poemIds.length > 0
        ? db
            .select({ id: poems.id, content: poems.content })
            .from(poems)
            .where(inArray(poems.id, poemIds))
        : Promise.resolve([]),
    ]);

    const voteStatsByDuel = new Map<string, { totalVotes: number; humanVotes: number }>();
    for (const stat of voteStats) {
      voteStatsByDuel.set(stat.duelId, {
        totalVotes: stat.totalVotes,
        humanVotes: stat.humanVotes,
      });
    }

    const contentByPoem = new Map<string, string>();
    for (const poem of poemContents) {
      contentByPoem.set(poem.id, poem.content);
    }

    const result = rows.map((r) => {
      const stats = voteStatsByDuel.get(r.id) ?? { totalVotes: 0, humanVotes: 0 };
      const contentA = contentByPoem.get(r.poemAId) ?? '';
      const contentB = contentByPoem.get(r.poemBId) ?? '';
      return {
        id: r.id,
        topic: r.topic,
        topicMeta: buildTopicMeta(r.topicId, r.topicLabel, r.topic),
        createdAt: r.createdAt,
        humanWinRate:
          stats.totalVotes > 0 ? Math.round((stats.humanVotes / stats.totalVotes) * 100) : 0,
        avgReadingTime: computeAvgReadingTime(contentA, contentB),
      };
    });

    return c.json(result);
  });

  // GET /duels/today — deprecated; must be registered before /:id to take priority
  router.get('/today', (_c) => {
    throw new EndpointNotFoundError();
  });

  // GET /duels/:id — canonical anonymous duel retrieval; logs to featured_duels
  router.get('/:id', async (c) => {
    const id = c.req.param('id');

    const [duelRow] = await db
      .select({
        id: duels.id,
        topic: duels.topic,
        poemAId: duels.poemAId,
        poemBId: duels.poemBId,
      })
      .from(duels)
      .where(eq(duels.id, id))
      .limit(1);

    if (!duelRow) throw new DuelNotFoundError();

    const [poemARows, poemBRows] = await Promise.all([
      db.select().from(poems).where(eq(poems.id, duelRow.poemAId)).limit(1),
      db.select().from(poems).where(eq(poems.id, duelRow.poemBId)).limit(1),
    ]);

    if (!poemARows[0] || !poemBRows[0]) throw new DuelNotFoundError();

    const today = new Date().toISOString().slice(0, 10);
    try {
      await db.insert(featuredDuels).values({ duelId: id, featuredOn: today });
    } catch (error) {
      if (!isMissingFeaturedDuelsTableError(error)) throw error;
    }

    return c.json({
      id: duelRow.id,
      topic: duelRow.topic,
      poemA: {
        id: poemARows[0].id,
        title: poemARows[0].title,
        content: poemARows[0].content,
      },
      poemB: {
        id: poemBRows[0].id,
        title: poemBRows[0].title,
        content: poemBRows[0].content,
      },
    });
  });

  // GET /duels/:id/stats — vote stats + full author reveal + sourceInfo
  router.get('/:id/stats', async (c) => {
    const id = c.req.param('id');

    const [duelRow] = await db
      .select({
        id: duels.id,
        topic: duels.topic,
        topicId: duels.topicId,
        topicLabel: topics.label,
        poemAId: duels.poemAId,
        poemBId: duels.poemBId,
      })
      .from(duels)
      .leftJoin(topics, eq(duels.topicId, topics.id))
      .where(eq(duels.id, id))
      .limit(1);

    if (!duelRow) throw new DuelNotFoundError();

    const [poemARows, poemBRows] = await Promise.all([
      db.select().from(poems).where(eq(poems.id, duelRow.poemAId)).limit(1),
      db.select().from(poems).where(eq(poems.id, duelRow.poemBId)).limit(1),
    ]);

    if (!poemARows[0] || !poemBRows[0]) throw new DuelNotFoundError();

    const poemA = poemARows[0];
    const poemB = poemBRows[0];

    // Fetch scrape_sources for both poems in a single query to avoid N+1
    const sourceRows = await db
      .select()
      .from(scrapeSources)
      .where(inArray(scrapeSources.poemId, [poemA.id, poemB.id]))
      .orderBy(desc(scrapeSources.scrapedAt));

    const sourcesByPoem = new Map<string, typeof sourceRows>();
    for (const row of sourceRows) {
      const existing = sourcesByPoem.get(row.poemId) ?? [];
      existing.push(row);
      sourcesByPoem.set(row.poemId, existing);
    }

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
      avgReadingTime: computeAvgReadingTime(poemA.content, poemB.content),
      duel: {
        id: duelRow.id,
        topic: duelRow.topic,
        topicMeta: buildTopicMeta(duelRow.topicId, duelRow.topicLabel, duelRow.topic),
        poemA: {
          id: poemA.id,
          title: poemA.title,
          content: poemA.content,
          author: poemA.author,
          type: poemA.type,
          year: poemA.year,
          sourceInfo: buildSourceInfo(poemA, sourcesByPoem),
        },
        poemB: {
          id: poemB.id,
          title: poemB.title,
          content: poemB.content,
          author: poemB.author,
          type: poemB.type,
          year: poemB.year,
          sourceInfo: buildSourceInfo(poemB, sourcesByPoem),
        },
      },
    });
  });

  // Catch ApiError subclasses thrown in route handlers and format them as
  // stable { error, code } JSON payloads with the correct HTTP status.
  router.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.message, code: err.code }, err.statusCode as 400 | 404 | 500);
    }
    throw err; // re-throw unexpected errors for the app-level handler
  });

  return router;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates the `page` query parameter and returns it as a number.
 * Throws InvalidPageError for 0, negative, non-integer, or non-numeric values.
 */
function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidPageError(`Invalid page value: "${raw}" — must be a positive integer`);
  }
  return n;
}

function isMissingFeaturedDuelsTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const causeMessage =
    error.cause instanceof Error
      ? error.cause.message
      : typeof error.cause === 'string'
        ? error.cause
        : '';
  const combinedMessage = `${error.message} ${causeMessage}`.toLowerCase();
  return combinedMessage.includes('no such table') && combinedMessage.includes('featured_duels');
}

/** Builds a topicMeta object. Falls back to { id: null, label: duelTopic } when join misses. */
function buildTopicMeta(
  topicId: string | null | undefined,
  topicLabel: string | null | undefined,
  duelTopic: string,
): { id: string | null; label: string } {
  if (topicLabel != null) {
    return { id: topicId ?? null, label: topicLabel };
  }
  return { id: null, label: duelTopic };
}

type PoemRow = {
  id: string;
  source: string | null;
  sourceUrl: string | null;
};

type ScrapeRow = {
  poemId: string;
  source: string;
  sourceUrl: string;
  scrapedAt: string;
  isPublicDomain: boolean;
};

/** Builds sourceInfo for a poem using its poem row and pre-fetched scrape sources. */
function buildSourceInfo(
  poem: PoemRow,
  sourcesByPoem: Map<string, ScrapeRow[]>,
): {
  primary: { source: string | null; sourceUrl: string | null };
  provenances: Array<{
    source: string;
    sourceUrl: string;
    scrapedAt: string;
    isPublicDomain: boolean;
  }>;
} {
  const provenances = (sourcesByPoem.get(poem.id) ?? []).map((s) => ({
    source: s.source,
    sourceUrl: s.sourceUrl,
    scrapedAt: s.scrapedAt,
    isPublicDomain: s.isPublicDomain,
  }));

  return {
    primary: {
      source: poem.source ?? null,
      sourceUrl: poem.sourceUrl ?? null,
    },
    provenances,
  };
}

function computeAvgReadingTime(contentA: string, contentB: string): string {
  const words = (contentA + ' ' + contentB).split(/\s+/).length;
  const seconds = Math.round((words / 200) * 60); // ~200 wpm reading speed
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
