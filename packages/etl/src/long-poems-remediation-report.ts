import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { createClient, type InStatement } from '@libsql/client';

import { resolveDbConfig } from '@sanctuary/db/config';

const PKG_ROOT = resolve(import.meta.dir, '..');
const SCOPED_IDS = [
  '19176bc9d632',
  'b45e1e960ad8',
  '92273a10aba0',
  'c8d1c4ef3331',
  'f399fdc5e1ab',
  'd87091e153a9',
] as const;

type Phase = 'preflight' | 'postflight';

function placeholders(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `:${prefix}${i}`).join(', ');
}

function bindIds(prefix: string, ids: readonly string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id, i) => [`${prefix}${i}`, id]));
}

async function scalarCount(
  client: ReturnType<typeof createClient>,
  stmt: InStatement,
): Promise<number> {
  const rs = await client.execute(stmt);
  const value = rs.rows[0]?.count;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      phase: { type: 'string', default: 'preflight' },
      out: { type: 'string' },
    },
    strict: true,
  });

  const phase = values.phase as Phase;
  if (phase !== 'preflight' && phase !== 'postflight') {
    throw new Error("--phase must be 'preflight' or 'postflight'");
  }

  loadEnv({ path: resolve(PKG_ROOT, '.env') });

  const dbConfig = resolveDbConfig();
  const client = createClient(dbConfig);
  const now = new Date().toISOString();

  const scopedIdParams = bindIds('id', SCOPED_IDS);
  const scopedIdPh = placeholders('id', SCOPED_IDS.length);

  const baseline = {
    human: await scalarCount(client, 'SELECT count(*) AS count FROM poems WHERE type = "HUMAN"'),
    ai: await scalarCount(client, 'SELECT count(*) AS count FROM poems WHERE type = "AI"'),
    unmatchedHuman: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM poems p
       WHERE p.type = 'HUMAN'
       AND NOT EXISTS (
         SELECT 1 FROM poems ai
         WHERE ai.type = 'AI' AND ai.parent_poem_id = p.id
       )`,
    ),
    duels: await scalarCount(client, 'SELECT count(*) AS count FROM duels'),
    votes: await scalarCount(client, 'SELECT count(*) AS count FROM votes'),
  };

  const scopedPoemsRs = await client.execute({
    sql: `SELECT id, title, author, type, year, source, source_url, form
          FROM poems
          WHERE id IN (${scopedIdPh})
          ORDER BY id`,
    args: scopedIdParams,
  });

  const duelRefsById = await Promise.all(
    SCOPED_IDS.map(async (poemId) => ({
      poemId,
      duelRefs: await scalarCount(client, {
        sql: 'SELECT count(*) AS count FROM duels WHERE poem_a_id = :id OR poem_b_id = :id',
        args: { id: poemId },
      }),
    })),
  );

  const scopedCounts = {
    poemTopics: await scalarCount(client, {
      sql: `SELECT count(*) AS count FROM poem_topics WHERE poem_id IN (${scopedIdPh})`,
      args: scopedIdParams,
    }),
    scrapeSources: await scalarCount(client, {
      sql: `SELECT count(*) AS count FROM scrape_sources WHERE poem_id IN (${scopedIdPh})`,
      args: scopedIdParams,
    }),
    duels: await scalarCount(client, {
      sql: `SELECT count(*) AS count
            FROM duels
            WHERE poem_a_id IN (${scopedIdPh}) OR poem_b_id IN (${scopedIdPh})`,
      args: { ...scopedIdParams },
    }),
    votesBySelectedPoem: await scalarCount(client, {
      sql: `SELECT count(*) AS count FROM votes WHERE selected_poem_id IN (${scopedIdPh})`,
      args: scopedIdParams,
    }),
  };

  const orphans = {
    poemTopics: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM poem_topics pt
       LEFT JOIN poems p ON p.id = pt.poem_id
       LEFT JOIN topics t ON t.id = pt.topic_id
       WHERE p.id IS NULL OR t.id IS NULL`,
    ),
    scrapeSources: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM scrape_sources s
       LEFT JOIN poems p ON p.id = s.poem_id
       WHERE p.id IS NULL`,
    ),
    duels: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM duels d
       LEFT JOIN poems pa ON pa.id = d.poem_a_id
       LEFT JOIN poems pb ON pb.id = d.poem_b_id
       WHERE pa.id IS NULL OR pb.id IS NULL`,
    ),
    votes: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM votes v
       LEFT JOIN duels d ON d.id = v.duel_id
       LEFT JOIN poems p ON p.id = v.selected_poem_id
       WHERE d.id IS NULL OR p.id IS NULL`,
    ),
    featuredDuels: await scalarCount(
      client,
      `SELECT count(*) AS count
       FROM featured_duels fd
       LEFT JOIN duels d ON d.id = fd.duel_id
       WHERE d.id IS NULL`,
    ),
  };

  const report = {
    phase,
    generatedAt: now,
    scopedIds: SCOPED_IDS,
    baseline,
    scoped: {
      poems: scopedPoemsRs.rows,
      duelRefsById,
      counts: scopedCounts,
    },
    orphans,
  };

  const defaultOut = resolve(
    PKG_ROOT,
    'data',
    'remediation-snapshots',
    `${now.replace(/[:.]/g, '-')}-${phase}.json`,
  );
  const outPath = resolve(values.out ?? defaultOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Wrote report: ${outPath}`);
  console.log(
    JSON.stringify(
      {
        phase,
        baseline,
        scopedDuelRefs: duelRefsById,
        orphans,
      },
      null,
      2,
    ),
  );

  await client.close();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
