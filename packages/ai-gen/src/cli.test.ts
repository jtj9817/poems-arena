import { describe, expect, mock, test } from 'bun:test';
import {
  parseCliArgs,
  runGenerationCli,
  type AssemblyRunResult,
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
      model: 'gemini-3-flash-preview',
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
      model: 'gemini-3-flash-preview',
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
      model: 'gemini-3-flash-preview',
      concurrency: 1,
      maxRetries: 1,
    };

    const summary = await runGenerationCli(config, dependencies);

    expect(assembleAfterRun).toHaveBeenCalledTimes(1);
    expect(summary.assemblyResult).toEqual({ totalCandidates: 0, newDuels: 0 });
    expect(logs.some((l) => l.includes('No unmatched human poems found'))).toBe(true);
    expect(logs.some((l) => l.includes('Running duel assembly'))).toBe(true);
  });
});
