/**
 * Backfill script for safe schema transitions.
 *
 * Purpose:
 * - Ensure existing duels rows have a non-null topic_id that references topics.id
 *   before enforcing NOT NULL / FK constraints.
 *
 * Run with:
 * - bun --env-file=../../.env run src/db/backfill.ts
 */
import { db } from './client';

async function tableExists(name: string): Promise<boolean> {
  const rs = await db.$client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return rs.rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rs = await db.$client.execute(`PRAGMA table_info(${table})`);
  return rs.rows.some((row) => row.name === column);
}

function topicIdFromLabel(label: string) {
  return `topic-${label.trim().toLowerCase().replaceAll(' ', '-')}`;
}

async function backfillDuelTopicIds() {
  const [hasDuels, hasTopics] = await Promise.all([tableExists('duels'), tableExists('topics')]);
  if (!hasDuels || !hasTopics) {
    return;
  }

  if (!(await columnExists('duels', 'topic_id')) || !(await columnExists('duels', 'topic'))) {
    return;
  }

  // Ensure topics rows exist for already-populated topic_id values.
  await db.$client.execute(`
    INSERT OR IGNORE INTO topics (id, label)
    SELECT DISTINCT topic_id, topic
    FROM duels
    WHERE topic_id IS NOT NULL AND trim(topic_id) != ''
  `);

  // Ensure topics rows exist for duels that still have NULL/empty topic_id.
  const duelsMissingTopicId = await db.$client.execute<{
    id: string;
    topic: string;
  }>(`
    SELECT id, topic
    FROM duels
    WHERE topic_id IS NULL OR trim(topic_id) = ''
  `);

  const unique = new Map<string, string>();
  for (const row of duelsMissingTopicId.rows) {
    const label = String(row.topic);
    const id = topicIdFromLabel(label);
    unique.set(id, label);
  }

  if (unique.size > 0) {
    const inserts = [...unique.entries()].map(([id, label]) => ({ id, label }));
    for (const entry of inserts) {
      await db.$client.execute({
        sql: `INSERT OR IGNORE INTO topics (id, label) VALUES (?, ?)`,
        args: [entry.id, entry.label],
      });
    }
  }

  // Backfill duels.topic_id now that the referenced topics rows exist.
  await db.$client.execute(`
    UPDATE duels
    SET topic_id = ('topic-' || lower(replace(topic, ' ', '-')))
    WHERE topic_id IS NULL OR trim(topic_id) = ''
  `);
}

async function main() {
  console.log('Backfilling duel topic IDs…');
  await backfillDuelTopicIds();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
