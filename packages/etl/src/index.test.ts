import { describe, expect, test } from 'bun:test';
import { parseCliArgs } from './index';

describe('parseCliArgs', () => {
  test('returns defaults when no arguments are provided', () => {
    const config = parseCliArgs([]);

    expect(config.stage).toBe('all');
    expect(config.dryRun).toBe(false);
    expect(config.includeNonPd).toBe(false);
    expect(config.limit).toBeUndefined();
    expect(config.inputDir).toContain('scraper/data/raw');
    expect(config.workDir).toContain('etl/data');
  });

  test('parses --stage flag', () => {
    const config = parseCliArgs(['--stage', 'clean']);
    expect(config.stage).toBe('clean');
  });

  test('parses --dry-run flag', () => {
    const config = parseCliArgs(['--dry-run']);
    expect(config.dryRun).toBe(true);
  });

  test('parses --include-non-pd flag', () => {
    const config = parseCliArgs(['--include-non-pd']);
    expect(config.includeNonPd).toBe(true);
  });

  test('parses --limit flag as a number', () => {
    const config = parseCliArgs(['--limit', '50']);
    expect(config.limit).toBe(50);
  });

  test('parses --input-dir override', () => {
    const config = parseCliArgs(['--input-dir', '/tmp/raw']);
    expect(config.inputDir).toBe('/tmp/raw');
  });

  test('parses --work-dir override', () => {
    const config = parseCliArgs(['--work-dir', '/tmp/etl']);
    expect(config.workDir).toBe('/tmp/etl');
  });

  test('parses all flags together', () => {
    const config = parseCliArgs([
      '--stage',
      'load',
      '--dry-run',
      '--include-non-pd',
      '--limit',
      '10',
      '--input-dir',
      '/data/in',
      '--work-dir',
      '/data/out',
    ]);

    expect(config.stage).toBe('load');
    expect(config.dryRun).toBe(true);
    expect(config.includeNonPd).toBe(true);
    expect(config.limit).toBe(10);
    expect(config.inputDir).toBe('/data/in');
    expect(config.workDir).toBe('/data/out');
  });
});
