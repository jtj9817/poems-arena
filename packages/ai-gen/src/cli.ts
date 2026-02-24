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
  log: (line: string) => void;
}

export interface CliRunSummary {
  totalCandidates: number;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  results: ProcessPoemResult[];
}

function createConcurrencyLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (activeCount >= concurrency) {
      return;
    }

    const next = queue.shift();
    if (!next) {
      return;
    }
    activeCount += 1;
    next();
  };

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        void task()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      };

      queue.push(run);
      runNext();
    });
  };
}

async function resolveLimiter(
  concurrency: number,
): Promise<(task: () => Promise<void>) => Promise<void>> {
  try {
    const { default: pLimit } = await import('p-limit');
    return pLimit(concurrency);
  } catch {
    return createConcurrencyLimiter(concurrency);
  }
}

function parsePositiveInt(raw: string | undefined, flagName: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
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
    return summary;
  }

  dependencies.log(`Found ${poems.length} unmatched human poem(s)`);
  const limit = await resolveLimiter(config.concurrency);

  const tasks = poems.map((poem) =>
    limit(async () => {
      let result: ProcessPoemResult;
      try {
        result = await dependencies.processPoem(poem, config);
      } catch (error) {
        result = {
          poemId: poem.id,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      summary.processed += 1;
      summary.results.push(result);

      if (result.status === 'stored') {
        summary.stored += 1;
        dependencies.log(
          `Stored AI poem for ${result.poemId} -> ${result.storedPoemId ?? '(unknown)'}`,
        );
      } else if (result.status === 'skipped') {
        summary.skipped += 1;
        dependencies.log(`Skipped ${result.poemId}: ${result.reason ?? 'no reason provided'}`);
      } else {
        summary.failed += 1;
        dependencies.log(`Failed ${result.poemId}: ${result.reason ?? 'unknown error'}`);
      }
    }),
  );

  await Promise.all(tasks);

  dependencies.log(
    `Completed generation run: processed=${summary.processed} stored=${summary.stored} skipped=${summary.skipped} failed=${summary.failed}`,
  );

  return summary;
}
