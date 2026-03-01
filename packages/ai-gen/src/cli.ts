import { parseArgs } from 'node:util';
import type { HumanPoemCandidate } from './persistence';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;

export interface CliConfig {
  topic?: string;
  limit?: number;
  model: string;
  concurrency: number;
  maxRetries: number;
}

export type ProcessPoemStatus = 'stored' | 'skipped' | 'failed';

export interface ProcessPoemResult {
  poemId: string;
  status: ProcessPoemStatus;
  storedPoemId?: string;
  reason?: string;
}

export interface CliDependencies {
  fetchPoems: (config: CliConfig) => Promise<HumanPoemCandidate[]>;
  processPoem: (poem: HumanPoemCandidate, config: CliConfig) => Promise<ProcessPoemResult>;
  /**
   * Optional hook called after poem generation completes.
   * Used to trigger duel assembly as part of the generation completion flow.
   */
  assembleAfterRun?: () => Promise<AssemblyRunResult>;
  log: (line: string) => void;
}

export interface AssemblyRunResult {
  totalCandidates: number;
  newDuels: number;
}

export interface CliRunSummary {
  totalCandidates: number;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  results: ProcessPoemResult[];
  assemblyResult?: AssemblyRunResult;
}

class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests = 5;
  private readonly windowMs = 60000;
  public totalWaitTimeMs = 0;
  private waiting: (() => void)[] = [];
  private isProcessing = false;

  async waitAndConsume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      void this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.waiting.length > 0) {
        const now = Date.now();
        this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

        if (this.timestamps.length < this.maxRequests) {
          this.timestamps.push(Date.now());
          const resolve = this.waiting.shift();
          if (resolve) resolve();
        } else {
          const oldest = this.timestamps[0];
          const waitTime = this.windowMs - (now - oldest);
          if (waitTime > 0) {
            this.totalWaitTimeMs += waitTime;
            await new Promise((r) => setTimeout(r, waitTime));
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

interface QueueItem {
  poem: HumanPoemCandidate;
  retries: number;
}

function parsePositiveInt(raw: string | undefined, flagName: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid ${flagName} value: "${raw}" (must be a positive integer)`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${flagName} value: "${raw}" (must be a positive integer)`);
  }

  return value;
}

export function parseCliArgs(argv: string[]): CliConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      topic: { type: 'string' },
      limit: { type: 'string' },
      model: { type: 'string', default: DEFAULT_MODEL },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      'max-retries': { type: 'string', default: String(DEFAULT_MAX_RETRIES) },
    },
    strict: true,
  });

  return {
    topic: values.topic ?? undefined,
    limit: parsePositiveInt(values.limit, '--limit'),
    model: values.model ?? DEFAULT_MODEL,
    concurrency: parsePositiveInt(values.concurrency, '--concurrency') ?? DEFAULT_CONCURRENCY,
    maxRetries: parsePositiveInt(values['max-retries'], '--max-retries') ?? DEFAULT_MAX_RETRIES,
  };
}

export async function runGenerationCli(
  config: CliConfig,
  dependencies: CliDependencies,
): Promise<CliRunSummary> {
  const summary: CliRunSummary = {
    totalCandidates: 0,
    processed: 0,
    stored: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  dependencies.log('Starting AI generation run');
  dependencies.log(`Model: ${config.model}`);
  dependencies.log(`Topic: ${config.topic ?? '(auto/default)'}`);
  dependencies.log(`Limit: ${config.limit ?? '(all unmatched)'}`);
  dependencies.log(`Concurrency: ${config.concurrency}`);
  dependencies.log(`Max retries: ${config.maxRetries}`);

  const poems = await dependencies.fetchPoems(config);
  summary.totalCandidates = poems.length;

  if (poems.length === 0) {
    dependencies.log('No unmatched human poems found.');
    dependencies.log('Completed generation run');

    if (dependencies.assembleAfterRun) {
      dependencies.log('Running duel assembly...');
      try {
        const assemblyResult = await dependencies.assembleAfterRun();
        summary.assemblyResult = assemblyResult;
        dependencies.log(
          `Duel assembly: ${assemblyResult.newDuels} new duel(s) created from ${assemblyResult.totalCandidates} candidate(s)`,
        );
      } catch (error) {
        dependencies.log(
          `Duel assembly failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return summary;
  }

  dependencies.log(`Found ${poems.length} unmatched human poem(s)`);

  const rateLimiter = new RateLimiter();
  const newQueue: QueueItem[] = poems.map((poem) => ({ poem, retries: 0 }));
  const failedQueue: QueueItem[] = [];
  let activeCount = 0;

  const startRunTime = Date.now();
  let totalSuccessTimeMs = 0;

  await new Promise<void>((resolveFinished) => {
    if (newQueue.length === 0) {
      resolveFinished();
      return;
    }

    const worker = async () => {
      while (true) {
        const item = failedQueue.shift() || newQueue.shift();

        if (!item) {
          if (activeCount === 0) {
            resolveFinished();
          }
          break;
        }

        activeCount++;
        try {
          await rateLimiter.waitAndConsume();

          const startTime = Date.now();
          let result: ProcessPoemResult;
          try {
            result = await dependencies.processPoem(item.poem, config);
          } catch (error) {
            result = {
              poemId: item.poem.id,
              status: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            };
          }
          const elapsed = Date.now() - startTime;
          const totalElapsedSoFar = Date.now() - startRunTime;

          if (result.status === 'failed') {
            if (item.retries < config.maxRetries) {
              item.retries++;
              failedQueue.push(item);
              dependencies.log(
                `Failed ${result.poemId} (retry ${item.retries}/${config.maxRetries}): ${
                  result.reason ?? 'unknown error'
                } [${elapsed}ms] (Total elapsed: ${totalElapsedSoFar}ms)`,
              );
            } else {
              summary.failed += 1;
              summary.processed += 1;
              summary.results.push(result);
              dependencies.log(
                `Failed ${result.poemId} permanently after ${item.retries} retries: ${
                  result.reason ?? 'unknown error'
                } [${elapsed}ms] (Total elapsed: ${totalElapsedSoFar}ms)`,
              );
            }
          } else {
            summary.processed += 1;
            summary.results.push(result);

            if (result.status === 'stored') {
              summary.stored += 1;
              totalSuccessTimeMs += elapsed;
              dependencies.log(
                `Stored AI poem for ${result.poemId} -> ${result.storedPoemId ?? '(unknown)'} [${elapsed}ms] (Total elapsed: ${totalElapsedSoFar}ms)`,
              );
            } else if (result.status === 'skipped') {
              summary.skipped += 1;
              dependencies.log(
                `Skipped ${result.poemId}: ${result.reason ?? 'no reason provided'} [${elapsed}ms] (Total elapsed: ${totalElapsedSoFar}ms)`,
              );
            }
          }
        } finally {
          activeCount--;
          if (activeCount === 0 && failedQueue.length === 0 && newQueue.length === 0) {
            resolveFinished();
          }
        }
      }
    };

    for (let i = 0; i < config.concurrency; i++) {
      void worker();
    }
  });

  const runTotalTime = Date.now() - startRunTime;
  const avgTime = summary.stored > 0 ? Math.round(totalSuccessTimeMs / summary.stored) : 0;

  dependencies.log(
    `Completed generation run: processed=${summary.processed} stored=${summary.stored} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  dependencies.log(`--- Run Summary ---`);
  dependencies.log(`Total elapsed wall time: ${runTotalTime}ms`);
  dependencies.log(`Average time per stored poem: ${avgTime}ms`);
  dependencies.log(`Rate limit wait time: ${rateLimiter.totalWaitTimeMs}ms`);

  if (dependencies.assembleAfterRun) {
    dependencies.log('Running duel assembly...');
    try {
      const assemblyResult = await dependencies.assembleAfterRun();
      summary.assemblyResult = assemblyResult;
      dependencies.log(
        `Duel assembly: ${assemblyResult.newDuels} new duel(s) created from ${assemblyResult.totalCandidates} candidate(s)`,
      );
    } catch (error) {
      dependencies.log(
        `Duel assembly failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}
