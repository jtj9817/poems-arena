import { describe, expect, test } from 'bun:test';
import {
  parseCliArgs,
  runGenerationCli,
  type CliConfig,
  type CliDependencies,
  type ProcessPoemResult,
} from './cli';
import type { HumanPoemCandidate } from './persistence';

describe('parseCliArgs', () => {
  test('parses CLI flags into typed config', () => {
    const config = parseCliArgs([
      '--topic',
      'nature',
      '--limit',
      '5',
      '--model',
      'gemini-3-flash-preview',
      '--concurrency',
      '2',
      '--max-retries',
      '3',
    ]);

    expect(config).toEqual({
      topic: 'nature',
      limit: 5,
      model: 'gemini-3-flash-preview',
      concurrency: 2,
      maxRetries: 3,
    });
  });

  test('defaults to processing all unmatched poems when no limit is provided', () => {
    const config = parseCliArgs([]);
    expect(config.limit).toBeUndefined();
    expect(config.model).toBe('gemini-3-flash-preview');
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

    const dependencies: CliDependencies = {
      fetchPoems: async () => poems,
      processPoem: async (poem): Promise<ProcessPoemResult> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
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
      model: 'gemini-3-flash-preview',
      concurrency: 2,
      maxRetries: 2,
    };

    const summary = await runGenerationCli(config, dependencies);

    expect(summary.totalCandidates).toBe(3);
    expect(summary.processed).toBe(3);
    expect(summary.stored).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(logs.some((line) => line.includes('Stored AI poem'))).toBe(true);
    expect(logs.some((line) => line.includes('Completed generation run'))).toBe(true);
  });
});
