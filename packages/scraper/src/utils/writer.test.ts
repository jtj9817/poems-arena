import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ScrapedPoem } from '../types';
import { writeScrapedPoems } from './writer';

const TMP_DIR = join(import.meta.dir, '../../.test-output');

function makeSample(overrides: Partial<ScrapedPoem> = {}): ScrapedPoem {
  return {
    sourceId: 'abc123',
    source: 'gutenberg',
    sourceUrl: 'https://www.gutenberg.org/files/12843/12843-h/12843-h.htm',
    title: 'The Sphinx',
    author: 'Ralph Waldo Emerson',
    year: '1867',
    content:
      'The Sphinx is drowsy,\nHer wings are furled:\nHer ear is heavy,\nShe broods on the world.',
    themes: ['myth', 'nature'],
    form: null,
    isPublicDomain: true,
    scrapedAt: '2026-02-20T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

describe('writeScrapedPoems', () => {
  test('creates the output directory if it does not exist', async () => {
    const outputDir = join(TMP_DIR, 'nested', 'raw');
    await writeScrapedPoems([makeSample()], outputDir, 'gutenberg');
    expect(existsSync(outputDir)).toBe(true);
  });

  test('writes a valid JSON file containing an array of ScrapedPoem', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = await writeScrapedPoems([makeSample()], TMP_DIR, 'gutenberg');

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sourceId).toBe('abc123');
    expect(parsed[0].title).toBe('The Sphinx');
    expect(parsed[0].themes).toEqual(['myth', 'nature']);
  });

  test('names the output file with source and ISO date', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = await writeScrapedPoems([makeSample()], TMP_DIR, 'gutenberg');

    const fileName = basename(filePath);
    expect(fileName).toMatch(/^gutenberg-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
  });

  test('preserves all ScrapedPoem fields on round-trip', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const original = makeSample({ year: null, form: 'ode' });
    const filePath = await writeScrapedPoems([original], TMP_DIR, 'poets.org');

    const parsed: ScrapedPoem[] = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed[0]).toEqual(original);
  });

  test('handles an empty poems array without error', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const filePath = await writeScrapedPoems([], TMP_DIR, 'loc-180');

    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed).toEqual([]);
  });

  test('writes multiple poems correctly', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const poems = [
      makeSample({ sourceId: 'a', title: 'First' }),
      makeSample({ sourceId: 'b', title: 'Second' }),
      makeSample({ sourceId: 'c', title: 'Third' }),
    ];
    const filePath = await writeScrapedPoems(poems, TMP_DIR, 'gutenberg');

    const parsed: ScrapedPoem[] = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed).toHaveLength(3);
    expect(parsed.map((p) => p.title)).toEqual(['First', 'Second', 'Third']);
  });

  test('sanitizes source to prevent path traversal', async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    // Attempt to write outside the output directory
    const maliciousSource = '../../etc/passwd';
    const filePath = await writeScrapedPoems([makeSample()], TMP_DIR, maliciousSource);

    // Should be written inside TMP_DIR, effectively treating "passwd" as the source name
    expect(filePath.startsWith(resolve(TMP_DIR))).toBe(true);
    const fileName = basename(filePath);
    expect(fileName).toMatch(/^passwd-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
  });
});
