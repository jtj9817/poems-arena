import { Hono } from 'hono';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@sanctuary/db';
import {
  duels,
  featuredDuels,
  globalStatistics,
  poems,
  scrapeSources,
  topicStatistics,
  topics,
  votes,
} from '../db/schema';
import {
  ApiError,
  DuelNotFoundError,
  EndpointNotFoundError,
  InvalidPageError,
  InvalidSeedError,
  MissingSeedError,
} from '../errors';
import { buildSeedPivot } from './seed-pivot';

export const DUELS_ARCHIVE_PAGE_SIZE = 12;

export function createDuelsRouter(db: Db) {
  const router = new Hono();

  // GET /duels — paginated archive with topicMeta; supports seed, sort, page, and topic_id params
  router.get('/', async (c) => {
    const rawPage = c.req.query('page');
    const page = parsePage(rawPage);
    const topicId = c.req.query('topic_id');
    const rawSeed = c.req.query('seed');
    const sort = c.req.query('sort');
    const limit = DUELS_ARCHIVE_PAGE_SIZE;
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
        topicDecisionTimeSumMs: topicStatistics.decisionTimeSumMs,
        topicDecisionTimeCount: topicStatistics.decisionTimeCount,
      })
      .from(duels)
      .leftJoin(topics, eq(duels.topicId, topics.id))
      .leftJoin(topicStatistics, eq(duels.topicId, topicStatistics.topicId))
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

    const voteStats =
      duelIds.length > 0
        ? await db
            .select({
              duelId: votes.duelId,
              totalVotes: sql<number>`count(${votes.id})`,
              humanVotes: sql<number>`sum(case when ${votes.isHuman} = 1 then 1 else 0 end)`,
            })
            .from(votes)
            .where(inArray(votes.duelId, duelIds))
            .groupBy(votes.duelId)
        : [];

    const voteStatsByDuel = new Map<string, { totalVotes: number; humanVotes: number }>();
    for (const stat of voteStats) {
      voteStatsByDuel.set(stat.duelId, {
        totalVotes: stat.totalVotes,
        humanVotes: stat.humanVotes,
      });
    }

    const result = rows.map((r) => {
      const stats = voteStatsByDuel.get(r.id) ?? { totalVotes: 0, humanVotes: 0 };
      const avg = computeAvgDecision(r.topicDecisionTimeSumMs, r.topicDecisionTimeCount);
      return {
        id: r.id,
        topic: r.topic,
        topicMeta: buildTopicMeta(r.topicId, r.topicLabel, r.topic),
        createdAt: r.createdAt,
        humanWinRate:
          stats.totalVotes > 0 ? Math.round((stats.humanVotes / stats.totalVotes) * 100) : 0,
        avgDecisionTimeMs: avg.avgDecisionTimeMs,
        avgDecisionTime: avg.avgDecisionTime,
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

    const [[stats], globalStatsRow, topicStatsRow] = await Promise.all([
      db
        .select({
          totalVotes: sql<number>`count(${votes.id})`,
          humanVotes: sql<number>`sum(case when ${votes.isHuman} = 1 then 1 else 0 end)`,
        })
        .from(votes)
        .where(eq(votes.duelId, id)),
      db
        .select()
        .from(globalStatistics)
        .where(eq(globalStatistics.id, 'global'))
        .limit(1)
        .then((r) => r[0]),
      db
        .select()
        .from(topicStatistics)
        .where(eq(topicStatistics.topicId, duelRow.topicId))
        .limit(1)
        .then((r) => r[0]),
    ]);

    const humanWinRate =
      stats.totalVotes > 0 ? Math.round((stats.humanVotes / stats.totalVotes) * 100) : 0;

    const globalTotalVotes = globalStatsRow?.totalVotes ?? 0;
    const globalHumanVotes = globalStatsRow?.humanVotes ?? 0;
    const globalAvg = computeAvgDecision(
      globalStatsRow?.decisionTimeSumMs,
      globalStatsRow?.decisionTimeCount,
    );

    const topicTotalVotes = topicStatsRow?.totalVotes ?? 0;
    const topicHumanVotes = topicStatsRow?.humanVotes ?? 0;
    const topicAvg = computeAvgDecision(
      topicStatsRow?.decisionTimeSumMs,
      topicStatsRow?.decisionTimeCount,
    );

    return c.json({
      humanWinRate,
      globalStats: {
        totalVotes: globalTotalVotes,
        humanWinRate:
          globalTotalVotes > 0 ? Math.round((globalHumanVotes / globalTotalVotes) * 100) : 0,
        avgDecisionTimeMs: globalAvg.avgDecisionTimeMs,
        avgDecisionTime: globalAvg.avgDecisionTime,
      },
      topicStats: {
        topicMeta: buildTopicMeta(duelRow.topicId, duelRow.topicLabel, duelRow.topic),
        totalVotes: topicTotalVotes,
        humanWinRate:
          topicTotalVotes > 0 ? Math.round((topicHumanVotes / topicTotalVotes) * 100) : 0,
        avgDecisionTimeMs: topicAvg.avgDecisionTimeMs,
        avgDecisionTime: topicAvg.avgDecisionTime,
      },
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

function computeAvgDecision(
  sumMs: number | null | undefined,
  count: number | null | undefined,
): { avgDecisionTimeMs: number | null; avgDecisionTime: string | null } {
  if (sumMs == null || count == null || count === 0) {
    return { avgDecisionTimeMs: null, avgDecisionTime: null };
  }
  const avgMs = Math.round(sumMs / count);
  const totalSeconds = Math.round(avgMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return { avgDecisionTimeMs: avgMs, avgDecisionTime: `${m}m ${s}s` };
}
