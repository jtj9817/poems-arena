import { describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  parseCliArgs,
  runGenerationCli,
  type AssemblyRunResult,
  type CliConfig,
  type CliDependencies,
  type ProcessPoemResult,
} from './cli';
import { assembleAndPersistDuels, type PersistenceDb as DuelAssemblyDb } from './duel-assembly';
import type { HumanPoemCandidate } from './persistence';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('parseCliArgs', () => {
  test('parses CLI flags into typed config', () => {
    const config = parseCliArgs([
      '--topic',
      'nature',
      '--limit',
      '5',
      '--model',
      'deepseek-chat',
      '--concurrency',
      '2',
      '--max-retries',
      '3',
    ]);

    expect(config).toEqual({
      topic: 'nature',
      limit: 5,
      model: 'deepseek-chat',
      concurrency: 2,
      maxRetries: 3,
    });
  });

  test('defaults to processing all unmatched poems when no limit is provided', () => {
    const config = parseCliArgs([]);
    expect(config.limit).toBeUndefined();
    expect(config.model).toBe('deepseek-chat');
  });

  test('rejects malformed numeric flags', () => {
    expect(() => parseCliArgs(['--limit', '5abc'])).toThrow(
      'Invalid --limit value: "5abc" (must be a positive integer)',
    );
    expect(() => parseCliArgs(['--concurrency', '2.7'])).toThrow(
      'Invalid --concurrency value: "2.7" (must be a positive integer)',
    );
    expect(() => parseCliArgs(['--max-retries', '1foo'])).toThrow(
      'Invalid --max-retries value: "1foo" (must be a positive integer)',
    );
  });
});

describe('runGenerationCli', () => {
  test('orchestrates batches with stateful summary and display output', async () => {
    const poems: HumanPoemCandidate[] = [
      { id: 'h1', title: 'One', content: '1\n2\n3\n4' },
      { id: 'h2', title: 'Two', content: '1\n2\n3\n4' },
      { id: 'h3', title: 'Three', content: '1\n2\n3\n4' },
    ];
    const logs: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const firstBatchGate = createDeferred<void>();
    const firstBatchStarted = createDeferred<void>();

    const dependencies: CliDependencies = {
      fetchPoems: async () => poems,
      processPoem: async (poem): Promise<ProcessPoemResult> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        if (inFlight === 2) {
          firstBatchStarted.resolve();
        }

        if (poem.id === 'h1' || poem.id === 'h2') {
          await firstBatchGate.promise;
        }

        inFlight -= 1;

        if (poem.id === 'h1') {
          return { poemId: poem.id, status: 'stored', storedPoemId: 'ai-h1' };
        }
        if (poem.id === 'h2') {
          return { poemId: poem.id, status: 'skipped', reason: 'quality_rejected' };
        }
        return { poemId: poem.id, status: 'failed', reason: 'provider_error' };
      },
      log: (line) => logs.push(line),
    };

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'deepseek-chat',
      concurrency: 2,
      maxRetries: 2,
    };

    const summaryPromise = runGenerationCli(config, dependencies);
    await firstBatchStarted.promise;
    expect(maxInFlight).toBe(2);
    firstBatchGate.resolve();

    const summary = await summaryPromise;

    expect(summary.totalCandidates).toBe(3);
    expect(summary.processed).toBe(3);
    expect(summary.stored).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(maxInFlight).toBe(2);
    expect(logs.some((line) => line.includes('Stored AI poem'))).toBe(true);
    expect(logs.some((line) => line.includes('Completed generation run'))).toBe(true);
  });

  test('calls assembleAfterRun hook after generation and records assembly result', async () => {
    const poems: HumanPoemCandidate[] = [{ id: 'h1', title: 'One', content: '1\n2\n3\n4' }];
    const logs: string[] = [];
    const assemblyResult: AssemblyRunResult = { totalCandidates: 2, newDuels: 1 };
    const assembleAfterRun = mock(async (): Promise<AssemblyRunResult> => assemblyResult);

    const dependencies: CliDependencies = {
      fetchPoems: async () => poems,
      processPoem: async (poem): Promise<ProcessPoemResult> => ({
        poemId: poem.id,
        status: 'stored',
        storedPoemId: 'ai-h1',
      }),
      assembleAfterRun,
      log: (line) => logs.push(line),
    };

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'deepseek-chat',
      concurrency: 1,
      maxRetries: 1,
    };

    const summary = await runGenerationCli(config, dependencies);

    expect(assembleAfterRun).toHaveBeenCalledTimes(1);
    expect(summary.assemblyResult).toEqual(assemblyResult);
    expect(logs.some((l) => l.includes('Running duel assembly'))).toBe(true);
    expect(logs.some((l) => l.includes('1 new duel(s) created from 2 candidate(s)'))).toBe(true);
  });

  test('logs assembly error and continues when assembleAfterRun throws', async () => {
    const poems: HumanPoemCandidate[] = [{ id: 'h1', title: 'One', content: '1\n2\n3\n4' }];
    const logs: string[] = [];

    const dependencies: CliDependencies = {
      fetchPoems: async () => poems,
      processPoem: async (poem): Promise<ProcessPoemResult> => ({
        poemId: poem.id,
        status: 'stored',
        storedPoemId: 'ai-h1',
      }),
      assembleAfterRun: async () => {
        throw new Error('DB connection failed');
      },
      log: (line) => logs.push(line),
    };

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'deepseek-chat',
      concurrency: 1,
      maxRetries: 1,
    };

    // Should not throw — assembly errors are swallowed and logged
    const summary = await runGenerationCli(config, dependencies);
    expect(summary.assemblyResult).toBeUndefined();
    expect(logs.some((l) => l.includes('Duel assembly failed'))).toBe(true);
    expect(logs.some((l) => l.includes('DB connection failed'))).toBe(true);
  });

  test('calls assembleAfterRun even when no poems are found', async () => {
    const logs: string[] = [];
    const assembleAfterRun = mock(
      async (): Promise<AssemblyRunResult> => ({ totalCandidates: 0, newDuels: 0 }),
    );

    const dependencies: CliDependencies = {
      fetchPoems: async () => [],
      processPoem: async (poem): Promise<ProcessPoemResult> => ({
        poemId: poem.id,
        status: 'stored',
      }),
      assembleAfterRun,
      log: (line) => logs.push(line),
    };

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'deepseek-chat',
      concurrency: 1,
      maxRetries: 1,
    };

    const summary = await runGenerationCli(config, dependencies);

    expect(assembleAfterRun).toHaveBeenCalledTimes(1);
    expect(summary.assemblyResult).toEqual({ totalCandidates: 0, newDuels: 0 });
    expect(logs.some((l) => l.includes('No unmatched human poems found'))).toBe(true);
    expect(logs.some((l) => l.includes('Running duel assembly'))).toBe(true);
  });

  test('running the generator with duel assembly creates a duel row in persistence', async () => {
    const sqlite = new Database(':memory:');
    const logs: string[] = [];

    sqlite.exec(`
      CREATE TABLE topics (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL
      );

      CREATE TABLE poems (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT NOT NULL,
        type TEXT NOT NULL
      );

      CREATE TABLE poem_topics (
        poem_id TEXT NOT NULL REFERENCES poems(id),
        topic_id TEXT NOT NULL REFERENCES topics(id)
      );

      CREATE TABLE duels (
        id TEXT PRIMARY KEY NOT NULL,
        topic TEXT NOT NULL,
        topic_id TEXT,
        poem_a_id TEXT NOT NULL REFERENCES poems(id),
        poem_b_id TEXT NOT NULL REFERENCES poems(id)
      );
    `);

    sqlite.run(`INSERT INTO topics (id, label) VALUES (?, ?)`, ['topic-nature', 'Nature']);
    sqlite.run(`INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)`, [
      'human-1',
      'Human One',
      'one\ntwo\nthree\nfour',
      'Human Author',
      'HUMAN',
    ]);
    sqlite.run(`INSERT INTO poem_topics (poem_id, topic_id) VALUES (?, ?)`, [
      'human-1',
      'topic-nature',
    ]);

    const persistenceDb: DuelAssemblyDb = {
      execute: async (query: string, params: unknown[] = []) => {
        const statement = sqlite.query(query);
        const isReadQuery = /^\s*(SELECT|WITH|PRAGMA)/i.test(query);

        if (isReadQuery) {
          return { rows: statement.all(...params) as Array<Record<string, unknown>> };
        }

        const runResult = statement.run(...params) as { changes?: number };
        return {
          rows: [],
          rowsAffected: typeof runResult.changes === 'number' ? runResult.changes : 0,
        };
      },
    };

    const dependencies: CliDependencies = {
      fetchPoems: async () => [
        { id: 'human-1', title: 'Human One', content: 'one\ntwo\nthree\nfour' },
      ],
      processPoem: async (poem): Promise<ProcessPoemResult> => {
        const aiPoemId = `ai-${poem.id}`;
        sqlite.run(`INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)`, [
          aiPoemId,
          'AI Counterpart',
          'one\ntwo\nthree\nfour',
          'AI Author',
          'AI',
        ]);
        sqlite.run(`INSERT INTO poem_topics (poem_id, topic_id) VALUES (?, ?)`, [
          aiPoemId,
          'topic-nature',
        ]);
        return { poemId: poem.id, status: 'stored', storedPoemId: aiPoemId };
      },
      assembleAfterRun: async () => assembleAndPersistDuels(persistenceDb),
      log: (line) => logs.push(line),
    };

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'deepseek-chat',
      concurrency: 1,
      maxRetries: 1,
    };

    try {
      const summary = await runGenerationCli(config, dependencies);
      expect(summary.assemblyResult).toEqual({ totalCandidates: 1, newDuels: 1 });

      const duelRows = sqlite
        .query(`SELECT topic_id AS topicId, poem_a_id AS poemAId, poem_b_id AS poemBId FROM duels`)
        .all() as Array<{ topicId: string; poemAId: string; poemBId: string }>;

      expect(duelRows).toHaveLength(1);
      expect(duelRows[0]?.topicId).toBe('topic-nature');
      expect([duelRows[0]?.poemAId, duelRows[0]?.poemBId]).toContain('human-1');
      expect([duelRows[0]?.poemAId, duelRows[0]?.poemBId]).toContain('ai-human-1');
      expect(logs.some((line) => line.includes('Running duel assembly'))).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
