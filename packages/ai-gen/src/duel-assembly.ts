import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TopicInfo {
  id: string;
  label: string;
}

export interface PoemWithTopics {
  id: string;
  type: 'HUMAN' | 'AI';
  topics: TopicInfo[];
}

export interface DuelCandidate {
  /** Deterministic hash of the sorted poem pair — unordered pair uniqueness key. */
  id: string;
  poemAId: string;
  poemBId: string;
  /** Display label resolved from the selected shared topic. */
  topic: string;
  /** FK to topics.id for the selected shared topic. */
  topicId: string;
}

export interface AssemblePairsOptions {
  humanPoems: PoemWithTopics[];
  aiPoems: PoemWithTopics[];
  /**
   * Set of duel IDs that already exist in the database.
   * Candidates whose deterministic ID appears here are skipped (idempotency).
   */
  existingDuelIds?: Set<string>;
  /**
   * Maximum number of AI counterparts to pair per HUMAN poem.
   * Prevents combinatorial explosion on large datasets.
   */
  maxFanOut?: number;
}

export interface PersistenceDb {
  execute(
    query: string,
    params?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowsAffected?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FAN_OUT = 10;
const SQLITE_MAX_BIND_PARAMS = 999;
const DUEL_INSERT_PARAM_COUNT = 5;
const DUEL_INSERT_CHUNK_SIZE = Math.max(
  1,
  Math.floor(SQLITE_MAX_BIND_PARAMS / DUEL_INSERT_PARAM_COUNT),
);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic duel ID from an unordered pair of poem IDs.
 * `buildDuelId(a, b) === buildDuelId(b, a)` always holds.
 */
function buildDuelId(poemIdA: string, poemIdB: string): string {
  const sorted = [poemIdA, poemIdB].sort();
  const digest = createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 12);
  return `duel-${digest}`;
}

/**
 * Derives a deterministic numeric seed from an unordered pair of poem IDs.
 * Used for topic selection and poem A/B position assignment.
 */
function seedFromPoemIds(poemIdA: string, poemIdB: string): number {
  const sorted = [poemIdA, poemIdB].sort();
  const hash = createHash('sha256').update(sorted.join(':')).digest();
  return hash.readUInt32BE(0);
}

/**
 * Selects one topic from the list of shared topics using a deterministic seed
 * derived from the poem IDs. This avoids alphabetical skew when multiple shared
 * topics exist — different pairs will consistently pick different topics.
 */
function selectSharedTopic(
  sharedTopics: TopicInfo[],
  humanPoemId: string,
  aiPoemId: string,
): TopicInfo {
  if (sharedTopics.length === 1) return sharedTopics[0]!;
  const sorted = [...sharedTopics].sort((a, b) => a.id.localeCompare(b.id));
  const seed = seedFromPoemIds(humanPoemId, aiPoemId);
  return sorted[seed % sorted.length]!;
}

/**
 * Assigns poem A/B positions deterministically based on the poem pair seed.
 * The assignment is randomised (not always HUMAN = poemA) but stable across
 * reruns for the same pair, ensuring preserved orientation on reruns.
 */
function assignPositions(
  humanPoemId: string,
  aiPoemId: string,
): { poemAId: string; poemBId: string } {
  const seed = seedFromPoemIds(humanPoemId, aiPoemId);
  if (seed % 2 === 0) {
    return { poemAId: humanPoemId, poemBId: aiPoemId };
  }
  return { poemAId: aiPoemId, poemBId: humanPoemId };
}

// ---------------------------------------------------------------------------
// Functional core — pure, side-effect free
// ---------------------------------------------------------------------------

/**
 * Assembles duel candidates from a set of HUMAN and AI poems with shared topic
 * memberships.
 *
 * Policy:
 * - Many-duels-per-poem: one HUMAN poem may pair with multiple AI poems.
 * - Unordered pair uniqueness: (A,B) and (B,A) produce the same duel ID.
 * - Bounded fan-out: at most `maxFanOut` AI poems per HUMAN poem, selected
 *   deterministically via seeded rank to avoid static lexicographic skew.
 * - Topic selection: when multiple shared topics exist the choice is seeded by
 *   the poem pair to avoid alphabetical skew.
 * - Idempotency: pairs whose deterministic ID is in `existingDuelIds` are skipped.
 */
export function assemblePairs(options: AssemblePairsOptions): DuelCandidate[] {
  const {
    humanPoems,
    aiPoems,
    existingDuelIds = new Set<string>(),
    maxFanOut = DEFAULT_MAX_FAN_OUT,
  } = options;

  // Build a topic → [AI poems] index for efficient intersection.
  const aiByTopicId = new Map<string, PoemWithTopics[]>();
  for (const ai of aiPoems) {
    for (const topic of ai.topics) {
      let bucket = aiByTopicId.get(topic.id);
      if (!bucket) {
        bucket = [];
        aiByTopicId.set(topic.id, bucket);
      }
      bucket.push(ai);
    }
  }

  const candidates: DuelCandidate[] = [];
  // Track IDs produced in this call to avoid duplicate pairs within the same
  // batch (e.g. two HUMAN poems that happen to generate the same duel ID).
  const seenThisRun = new Set<string>(existingDuelIds);

  for (const human of humanPoems) {
    const humanTopicIdSet = new Set(human.topics.map((t) => t.id));

    // Collect distinct eligible AI poems that share at least one topic.
    const eligibleMap = new Map<string, PoemWithTopics>();
    for (const topicId of humanTopicIdSet) {
      for (const ai of aiByTopicId.get(topicId) ?? []) {
        eligibleMap.set(ai.id, ai);
      }
    }

    if (eligibleMap.size === 0) continue;

    const eligible = [...eligibleMap.values()].sort((a, b) => {
      const rankA = seedFromPoemIds(human.id, a.id);
      const rankB = seedFromPoemIds(human.id, b.id);
      if (rankA !== rankB) return rankA - rankB;
      return a.id.localeCompare(b.id);
    });
    const capped = eligible.slice(0, maxFanOut);

    for (const ai of capped) {
      // Find shared topic IDs between this human and AI poem.
      const aiTopicIdSet = new Set(ai.topics.map((t) => t.id));
      const sharedTopicIds = [...humanTopicIdSet].filter((id) => aiTopicIdSet.has(id));

      if (sharedTopicIds.length === 0) continue; // safety guard — should not happen

      // Resolve full TopicInfo objects for the shared IDs.
      const sharedTopics: TopicInfo[] = sharedTopicIds.map((id) => {
        return (
          human.topics.find((t) => t.id === id) ??
          ai.topics.find((t) => t.id === id) ?? { id, label: id }
        );
      });

      const selectedTopic = selectSharedTopic(sharedTopics, human.id, ai.id);
      const duelId = buildDuelId(human.id, ai.id);

      if (seenThisRun.has(duelId)) continue;
      seenThisRun.add(duelId);

      const { poemAId, poemBId } = assignPositions(human.id, ai.id);

      candidates.push({
        id: duelId,
        poemAId,
        poemBId,
        topic: selectedTopic.label,
        topicId: selectedTopic.id,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Database side-effects
// ---------------------------------------------------------------------------

/**
 * Fetches all HUMAN and AI poems together with their topic memberships.
 * Returns poems that have at least one associated topic.
 */
export async function fetchPoemsWithTopics(db: PersistenceDb): Promise<PoemWithTopics[]> {
  const result = await db.execute(`
    SELECT p.id, p.type, pt.topic_id, t.label AS topic_label
    FROM poems p
    INNER JOIN poem_topics pt ON pt.poem_id = p.id
    INNER JOIN topics t ON t.id = pt.topic_id
    WHERE p.type IN ('HUMAN', 'AI')
    ORDER BY p.id ASC, pt.topic_id ASC
  `);

  // Group by poem ID.
  const poemMap = new Map<string, PoemWithTopics>();

  for (const row of result.rows) {
    const id = row.id !== null && row.id !== undefined ? String(row.id) : null;
    const type = row.type !== null && row.type !== undefined ? String(row.type) : null;
    const topicId =
      row.topic_id !== null && row.topic_id !== undefined ? String(row.topic_id) : null;
    const topicLabel =
      row.topic_label !== null && row.topic_label !== undefined ? String(row.topic_label) : null;

    if (!id || !type || !topicId || !topicLabel) continue;
    if (type !== 'HUMAN' && type !== 'AI') continue;

    let poem = poemMap.get(id);
    if (!poem) {
      poem = { id, type, topics: [] };
      poemMap.set(id, poem);
    }
    poem.topics.push({ id: topicId, label: topicLabel });
  }

  return [...poemMap.values()];
}

/**
 * Fetches the set of all existing duel IDs for idempotency checks.
 */
export async function fetchExistingDuelIds(db: PersistenceDb): Promise<Set<string>> {
  const result = await db.execute(`SELECT id FROM duels`);
  const ids = new Set<string>();
  for (const row of result.rows) {
    if (row.id !== null && row.id !== undefined) {
      ids.add(String(row.id));
    }
  }
  return ids;
}

/**
 * Bulk-inserts duel candidates using INSERT OR IGNORE (idempotent).
 * Returns the number of rows actually inserted.
 */
export async function persistDuelCandidates(
  db: PersistenceDb,
  candidates: DuelCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  let insertedCount = 0;
  for (let i = 0; i < candidates.length; i += DUEL_INSERT_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + DUEL_INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((candidate) => [
      candidate.id,
      candidate.topic,
      candidate.topicId,
      candidate.poemAId,
      candidate.poemBId,
    ]);

    const result = await db.execute(
      `INSERT OR IGNORE INTO duels (id, topic, topic_id, poem_a_id, poem_b_id)
       VALUES ${placeholders}`,
      params,
    );

    if (typeof result.rowsAffected === 'number' && Number.isFinite(result.rowsAffected)) {
      insertedCount += Math.max(0, Math.trunc(result.rowsAffected));
    }
  }

  return insertedCount;
}

export async function assembleAndPersistDuels(
  db: PersistenceDb,
  options?: { maxFanOut?: number },
): Promise<{ totalCandidates: number; newDuels: number }> {
  const poems = await fetchPoemsWithTopics(db);

  const humanPoems = poems.filter((p) => p.type === 'HUMAN');
  const aiPoems = poems.filter((p) => p.type === 'AI');

  const candidates = assemblePairs({
    humanPoems,
    aiPoems,
    maxFanOut: options?.maxFanOut,
  });

  const newDuels = await persistDuelCandidates(db, candidates);

  return { totalCandidates: candidates.length, newDuels };
}
