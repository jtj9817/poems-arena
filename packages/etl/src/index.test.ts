import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { parseCliArgs } from './index';

describe('parseCliArgs', () => {
  test('returns defaults when no arguments are provided', () => {
    const config = parseCliArgs([]);

    expect(config.stage).toBe('all');
    expect(config.dryRun).toBe(false);
    expect(config.includeNonPd).toBe(false);
    expect(config.limit).toBeUndefined();
    expect(config.inputDir.replaceAll('\\', '/')).toContain('scraper/data/raw');
    expect(config.workDir.replaceAll('\\', '/')).toContain('etl/data');
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
    const inputDir = join('tmp', 'raw');
    const config = parseCliArgs(['--input-dir', inputDir]);
    expect(config.inputDir).toBe(inputDir);
  });

  test('parses --work-dir override', () => {
    const workDir = join('tmp', 'etl');
    const config = parseCliArgs(['--work-dir', workDir]);
    expect(config.workDir).toBe(workDir);
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
      join('data', 'in'),
      '--work-dir',
      join('data', 'out'),
    ]);

    expect(config.stage).toBe('load');
    expect(config.dryRun).toBe(true);
    expect(config.includeNonPd).toBe(true);
    expect(config.limit).toBe(10);
    expect(config.inputDir).toBe(join('data', 'in'));
    expect(config.workDir).toBe(join('data', 'out'));
  });
});
