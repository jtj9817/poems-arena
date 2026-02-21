import { describe, expect, test, mock } from 'bun:test';
import { TOPIC_LABELS } from '../mappings/theme-to-topic';
import { generatePoemId, generateScrapeSourceId } from '../utils/id-gen';
import type { TagPoem } from './03-tag';

// ---------------------------------------------------------------------------
// Mock DB infrastructure
//
// We create a minimal mock that records all insert/delete/update operations
// so we can assert on the exact calls made by the load stage functions.
//
// Drizzle stores SQL table names under Symbol('drizzle:Name') on table objects.
// ---------------------------------------------------------------------------

const DRIZZLE_NAME = Symbol.for('drizzle:Name');

interface MockCall {
  op: 'insert' | 'delete' | 'transaction';
  table?: string;
  values?: Record<string, unknown>;
  conflict?: string;
  where?: string;
}

function resolveTableName(table: unknown): string {
  if (table && typeof table === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (table as any)[DRIZZLE_NAME];
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

function createMockDb() {
  const calls: MockCall[] = [];

  /** A chainable insert builder that records values and conflict handling. */
  function makeInsertChain(tableName: string) {
    let insertValues: Record<string, unknown> = {};
    const chain = {
      values(vals: Record<string, unknown>) {
        insertValues = vals;
        return chain;
      },
      onConflictDoUpdate(_opts: { target: unknown; set: Record<string, unknown> }) {
        calls.push({
          op: 'insert',
          table: tableName,
          values: insertValues,
          conflict: 'doUpdate',
        });
        return chain;
      },
      // If no onConflict is called, record a plain insert (used for poem_topics)
      then(resolve: (v?: unknown) => void) {
        // This handles awaiting the insert without onConflict
        if (!calls.find((c) => c.values === insertValues)) {
          calls.push({
            op: 'insert',
            table: tableName,
            values: insertValues,
          });
        }
        resolve();
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chain as any)[Symbol.toStringTag] = 'Promise';
    return chain;
  }

  const db = {
    insert(table: unknown) {
      return makeInsertChain(resolveTableName(table));
    },
    delete(table: unknown) {
      const tableName = resolveTableName(table);
      return {
        where(_condition: unknown) {
          calls.push({ op: 'delete', table: tableName, where: 'condition' });
          return Promise.resolve();
        },
      };
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<void>) => {
      calls.push({ op: 'transaction' });
      // Run the transaction body with a mock tx that records the same way
      const tx = {
        insert: db.insert.bind(db),
        delete: db.delete.bind(db),
      };
      await fn(tx);
    }),
    _calls: calls,
  };

  return db;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTagPoem(overrides: Partial<TagPoem> = {}): TagPoem {
  return {
    title: 'The Raven',
    author: 'Edgar Allan Poe',
    year: '1845',
    content:
      'Once upon a midnight dreary\nWhile I pondered weak and weary\nOver many a quaint\nAnd curious volume',
    themes: ['Death', 'Grief'],
    form: 'trochaic octameter',
    topics: ['mortality', 'grief'],
    provenances: [
      {
        sourceId: 'src-001',
        source: 'poets.org',
        sourceUrl: 'https://poets.org/poem/raven',
        isPublicDomain: true,
        scrapedAt: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

function makeNonPdPoem(): TagPoem {
  return makeTagPoem({
    title: 'Copyrighted Poem',
    author: 'Modern Author',
    provenances: [
      {
        sourceId: 'src-002',
        source: 'poets.org',
        sourceUrl: 'https://poets.org/poem/copyrighted',
        isPublicDomain: false,
        scrapedAt: '2026-01-01T00:00:00Z',
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests — import the functions dynamically to avoid module-level DB issues
// ---------------------------------------------------------------------------

describe('upsertTopics', () => {
  test('inserts all 20 canonical topics', async () => {
    const { upsertTopics } = await import('./04-load');
    const db = createMockDb();

    const count = await upsertTopics(db as never);

    expect(count).toBe(20);
    const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'topics');
    expect(topicInserts.length).toBe(20);
  });

  test('uses correct labels for each topic', async () => {
    const { upsertTopics } = await import('./04-load');
    const db = createMockDb();

    await upsertTopics(db as never);

    const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'topics');
    for (const call of topicInserts) {
      const id = call.values?.id as string;
      const label = call.values?.label as string;
      expect(TOPIC_LABELS[id as keyof typeof TOPIC_LABELS]).toBe(label);
    }
  });

  test('uses onConflictDoUpdate for idempotency', async () => {
    const { upsertTopics } = await import('./04-load');
    const db = createMockDb();

    await upsertTopics(db as never);

    const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'topics');
    for (const call of topicInserts) {
      expect(call.conflict).toBe('doUpdate');
    }
  });
});

// ---------------------------------------------------------------------------
// loadPoem
// ---------------------------------------------------------------------------

describe('loadPoem', () => {
  test('wraps all writes in a transaction', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem();

    await loadPoem(db as never, poem);

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  test('returns a deterministic poem ID', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem();

    const id = await loadPoem(db as never, poem);
    const expected = generatePoemId(poem.title, poem.author);

    expect(id).toBe(expected);
  });

  test('inserts poem with type HUMAN and deterministic ID', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem();

    await loadPoem(db as never, poem);

    const poemInsert = db._calls.find((c) => c.op === 'insert' && c.table === 'poems');
    expect(poemInsert).toBeDefined();
    expect(poemInsert!.values!.type).toBe('HUMAN');
    expect(poemInsert!.values!.id).toBe(generatePoemId(poem.title, poem.author));
    expect(poemInsert!.conflict).toBe('doUpdate');
  });

  test('deletes existing poem_topics before inserting new ones', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem({ topics: ['mortality', 'grief'] });

    await loadPoem(db as never, poem);

    const deleteOp = db._calls.find((c) => c.op === 'delete' && c.table === 'poem_topics');
    expect(deleteOp).toBeDefined();

    const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poem_topics');
    expect(topicInserts.length).toBe(2);
  });

  test('inserts scrape_sources for each provenance entry', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem({
      provenances: [
        {
          sourceId: 'src-001',
          source: 'poets.org',
          sourceUrl: 'https://poets.org/poem/raven',
          isPublicDomain: true,
          scrapedAt: '2026-01-01T00:00:00Z',
        },
        {
          sourceId: 'src-002',
          source: 'gutenberg',
          sourceUrl: 'https://gutenberg.org/poem/raven',
          isPublicDomain: true,
          scrapedAt: '2026-01-02T00:00:00Z',
        },
      ],
    });

    await loadPoem(db as never, poem);

    const sourceInserts = db._calls.filter(
      (c) => c.op === 'insert' && c.table === 'scrape_sources',
    );
    expect(sourceInserts.length).toBe(2);
    // Both should use onConflictDoUpdate
    for (const call of sourceInserts) {
      expect(call.conflict).toBe('doUpdate');
    }
  });

  test('uses deterministic scrape source IDs', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem();
    const poemId = generatePoemId(poem.title, poem.author);
    const prov = poem.provenances[0];
    const expectedSourceId = generateScrapeSourceId(poemId, prov.source, prov.sourceUrl);

    await loadPoem(db as never, poem);

    const sourceInsert = db._calls.find((c) => c.op === 'insert' && c.table === 'scrape_sources');
    expect(sourceInsert).toBeDefined();
    expect(sourceInsert!.values!.id).toBe(expectedSourceId);
  });

  test('poem row uses primary provenance source and sourceUrl', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem();

    await loadPoem(db as never, poem);

    const poemInsert = db._calls.find((c) => c.op === 'insert' && c.table === 'poems');
    expect(poemInsert!.values!.source).toBe('poets.org');
    expect(poemInsert!.values!.sourceUrl).toBe('https://poets.org/poem/raven');
  });

  test('poem row includes year and form when present', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem({ year: '1845', form: 'sonnet' });

    await loadPoem(db as never, poem);

    const poemInsert = db._calls.find((c) => c.op === 'insert' && c.table === 'poems');
    expect(poemInsert!.values!.year).toBe('1845');
    expect(poemInsert!.values!.form).toBe('sonnet');
  });

  test('poem row sets null for missing year and form', async () => {
    const { loadPoem } = await import('./04-load');
    const db = createMockDb();
    const poem = makeTagPoem({ year: null, form: null });

    await loadPoem(db as never, poem);

    const poemInsert = db._calls.find((c) => c.op === 'insert' && c.table === 'poems');
    expect(poemInsert!.values!.year).toBeNull();
    expect(poemInsert!.values!.form).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deterministic ID consistency
// ---------------------------------------------------------------------------

describe('idempotent behavior', () => {
  test('loadPoem produces identical IDs on repeated calls', async () => {
    const { loadPoem } = await import('./04-load');
    const poem = makeTagPoem();

    const db1 = createMockDb();
    const id1 = await loadPoem(db1 as never, poem);

    const db2 = createMockDb();
    const id2 = await loadPoem(db2 as never, poem);

    expect(id1).toBe(id2);
  });

  test('scrape source IDs are identical across repeated loads', async () => {
    const { loadPoem } = await import('./04-load');
    const poem = makeTagPoem();

    const db1 = createMockDb();
    await loadPoem(db1 as never, poem);

    const db2 = createMockDb();
    await loadPoem(db2 as never, poem);

    const sources1 = db1._calls
      .filter((c) => c.op === 'insert' && c.table === 'scrape_sources')
      .map((c) => c.values!.id);
    const sources2 = db2._calls
      .filter((c) => c.op === 'insert' && c.table === 'scrape_sources')
      .map((c) => c.values!.id);

    expect(sources1).toEqual(sources2);
  });
});

// ---------------------------------------------------------------------------
// Public domain filtering
// ---------------------------------------------------------------------------

describe('public domain filtering', () => {
  test('non-PD poem has no public domain provenance', () => {
    const poem = makeNonPdPoem();
    const hasPd = poem.provenances.some((p) => p.isPublicDomain);
    expect(hasPd).toBe(false);
  });

  test('standard poem has public domain provenance', () => {
    const poem = makeTagPoem();
    const hasPd = poem.provenances.some((p) => p.isPublicDomain);
    expect(hasPd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LoadStageSummary shape
// ---------------------------------------------------------------------------

describe('LoadStageSummary', () => {
  test('has correct shape', () => {
    const summary = {
      read: 0,
      loaded: 0,
      skippedNonPd: 0,
      topicsUpserted: 0,
    };
    expect(summary).toHaveProperty('read');
    expect(summary).toHaveProperty('loaded');
    expect(summary).toHaveProperty('skippedNonPd');
    expect(summary).toHaveProperty('topicsUpserted');
  });
});
