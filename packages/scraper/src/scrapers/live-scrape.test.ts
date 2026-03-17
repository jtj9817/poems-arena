import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scrapeGutenbergEmerson } from './gutenberg';
import { scrapeLoc180 } from './loc-180';
import { scrapePoetsOrg } from './poets-org';
import { ScrapedPoem } from '../types';

const shouldRunLiveScrapes = process.env.SCRAPER_LIVE_TESTS === 'true';
const dbPath =
  process.env.SCRAPER_TEST_DB_PATH ??
  join(tmpdir(), `poems-arena-scraper-live-test-${randomUUID()}.sqlite`);
const keepTestDb = process.env.SCRAPER_TEST_DB_KEEP === 'true';

const suite = shouldRunLiveScrapes ? describe : describe.skip;

suite('live scraper integration', () => {
  let db: Database | null = null;
  let networkAvailable = false;

  const cleanupDb = () => {
    if (db) {
      db.close();
      db = null;
    }

    if (!keepTestDb && existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
    }
  };

  beforeAll(async () => {
    try {
      if (existsSync(dbPath)) {
        rmSync(dbPath, { force: true });
      }

      db = new Database(dbPath);
      db.run(`
        CREATE TABLE IF NOT EXISTS scraped_poems (
          source_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_url TEXT NOT NULL,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          scraped_at TEXT NOT NULL
        )
      `);

      try {
        const response = await fetch('https://poets.org/poems?page=0');
        networkAvailable = response.ok;
      } catch {
        networkAvailable = false;
      }

      if (!networkAvailable) {
        console.warn(
          'Live scraper integration tests are running in offline mode; network assertions are skipped.',
        );
      }
    } catch (error) {
      cleanupDb();
      throw error;
    }
  });

  afterAll(() => {
    cleanupDb();
  });

  function savePoem(poem: ScrapedPoem): void {
    if (!db) {
      throw new Error('Live test database is not initialized');
    }

    db.run(
      `
      INSERT OR REPLACE INTO scraped_poems (
        source_id, source, source_url, title, author, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [poem.sourceId, poem.source, poem.sourceUrl, poem.title, poem.author, poem.scrapedAt],
    );
  }

  test('scrapes at least one poem from Gutenberg and persists to the test database', async () => {
    if (!networkAvailable) {
      expect(true).toBe(true);
      return;
    }

    const poems = await scrapeGutenbergEmerson();

    expect(poems.length).toBeGreaterThan(0);
    savePoem(poems[0]);
  });

  test('scrapes at least one poem from LOC Poetry 180 and persists to the test database', async () => {
    if (!networkAvailable) {
      expect(true).toBe(true);
      return;
    }

    const poems = await scrapeLoc180(1, 1);

    expect(poems.length).toBeGreaterThan(0);
    savePoem(poems[0]);
  });

  test('scrapes at least one poem from Poets.org and persists to the test database', async () => {
    if (!networkAvailable) {
      expect(true).toBe(true);
      return;
    }

    const poems = await scrapePoetsOrg(1);

    expect(poems.length).toBeGreaterThan(0);
    savePoem(poems[0]);
  });

  test('stores at least three scraped poems in the isolated test database', () => {
    if (!db) {
      throw new Error('Live test database is not initialized');
    }

    const row = db.query('SELECT COUNT(*) AS count FROM scraped_poems').get() as {
      count: number;
    };

    if (networkAvailable) {
      expect(row.count).toBeGreaterThanOrEqual(3);
      return;
    }

    expect(row.count).toBe(0);
  });
});
