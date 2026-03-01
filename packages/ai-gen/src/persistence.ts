import { createHash } from 'node:crypto';
import type { PoemOutput } from './deepseek-client';

export interface HumanPoemCandidate {
  id: string;
  title: string;
  content: string;
}

export interface FetchUnmatchedHumanPoemsParams {
  db: PersistenceDb;
  topic?: string;
  limit?: number;
}

export interface AiPoemInsertValues {
  id: string;
  title: string;
  content: string;
  author: string;
  type: 'AI';
  source: 'ai-generated';
  prompt: string;
  parentPoemId: string;
}

export interface PersistGeneratedPoemParams {
  db: PersistenceDb;
  parentPoem: HumanPoemCandidate;
  generatedPoem: PoemOutput;
  prompt: string;
  model: string;
}

export interface PersistedAiPoem {
  id: string;
  title: string;
  content: string;
  author: string;
  type: 'AI';
  source: string | null;
  prompt: string | null;
  parentPoemId: string | null;
}

export interface PersistenceDb {
  execute(
    query: string,
    params?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

async function executeQuery(
  db: PersistenceDb,
  query: string,
  params: unknown[] = [],
): Promise<{ rows: Array<Record<string, unknown>> }> {
  return db.execute(query, params);
}

export async function fetchUnmatchedHumanPoems(
  params: FetchUnmatchedHumanPoemsParams,
): Promise<HumanPoemCandidate[]> {
  const { db, topic, limit } = params;

  const topicFilter = topic
    ? `AND EXISTS (
      SELECT 1
      FROM poem_topics pt
      INNER JOIN topics t ON t.id = pt.topic_id
      WHERE pt.poem_id = p.id
        AND (LOWER(t.id) = LOWER(?) OR LOWER(t.label) = LOWER(?))
    )`
    : '';

  const limitClause = limit !== undefined ? 'LIMIT ?' : '';
  const query = `
    SELECT p.id, p.title, p.content
    FROM poems p
    WHERE p.type = 'HUMAN'
      AND NOT EXISTS (
        SELECT 1
        FROM poems ai
        WHERE ai.parent_poem_id = p.id
          AND ai.type = 'AI'
      )
      ${topicFilter}
    ORDER BY p.id ASC
    ${limitClause}
  `;

  const queryParams: unknown[] = [];
  if (topic) {
    queryParams.push(topic, topic);
  }
  if (limit !== undefined) {
    queryParams.push(limit);
  }

  const result = await executeQuery(db, query, queryParams);

  return result.rows
    .map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.title ?? ''),
      content: String(row.content ?? ''),
    }))
    .filter((row) => row.id.length > 0 && row.title.length > 0 && row.content.length > 0);
}

function buildAiPoemId(parentPoemId: string, model: string): string {
  const digest = createHash('sha256').update(`${parentPoemId}:${model}`).digest('hex').slice(0, 12);
  return `ai-${parentPoemId}-${digest}`;
}

export function buildAiPoemInsertValues(params: {
  parentPoem: HumanPoemCandidate;
  generatedPoem: PoemOutput;
  prompt: string;
  model: string;
}): AiPoemInsertValues {
  const { parentPoem, generatedPoem, prompt, model } = params;

  return {
    id: buildAiPoemId(parentPoem.id, model),
    title: generatedPoem.title,
    content: generatedPoem.content,
    author: model,
    type: 'AI',
    source: 'ai-generated',
    prompt,
    parentPoemId: parentPoem.id,
  };
}

export async function persistGeneratedPoem(
  params: PersistGeneratedPoemParams,
): Promise<PersistedAiPoem> {
  const insertValues = buildAiPoemInsertValues(params);

  await executeQuery(
    params.db,
    `INSERT OR IGNORE INTO poems (
      id, title, content, author, type, source, prompt, parent_poem_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      insertValues.id,
      insertValues.title,
      insertValues.content,
      insertValues.author,
      insertValues.type,
      insertValues.source,
      insertValues.prompt,
      insertValues.parentPoemId,
    ],
  );

  // Copy parent poem's topic associations to the AI poem so duel assembly
  // can pair them under a shared topic.
  await executeQuery(
    params.db,
    `INSERT OR IGNORE INTO poem_topics (poem_id, topic_id)
     SELECT ?, topic_id
     FROM poem_topics
     WHERE poem_id = ?`,
    [insertValues.id, insertValues.parentPoemId],
  );

  const readResult = await executeQuery(
    params.db,
    `SELECT id, title, content, author, type, source, prompt, parent_poem_id AS parentPoemId
     FROM poems
     WHERE id = ?
     LIMIT 1`,
    [insertValues.id],
  );

  const stored = readResult.rows[0];
  if (!stored || stored.type !== 'AI') {
    throw new Error(`Failed to persist generated AI poem for parent "${params.parentPoem.id}"`);
  }

  return {
    id: String(stored.id),
    title: String(stored.title),
    content: String(stored.content),
    author: String(stored.author),
    type: 'AI',
    source: stored.source === null ? null : String(stored.source),
    prompt: stored.prompt === null ? null : String(stored.prompt),
    parentPoemId: stored.parentPoemId === null ? null : String(stored.parentPoemId),
  };
}
