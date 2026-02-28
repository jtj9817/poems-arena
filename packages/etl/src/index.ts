import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { runCleanStage } from './stages/01-clean';
import { runDedupStage } from './stages/02-dedup';
import { runTagStage } from './stages/03-tag';
import { runLoadStage } from './stages/04-load';
import { resolveDbConfig } from '@sanctuary/db/config';
import { createDb } from '@sanctuary/db/client';
import { stageStart, stageEnd, pipelineSummary } from './logger';

export type Stage = 'clean' | 'dedup' | 'tag' | 'load' | 'all';

export interface CliConfig {
  stage: Stage;
  dryRun: boolean;
  includeNonPd: boolean;
  limit: number | undefined;
  inputDir: string;
  workDir: string;
}

const PKG_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_INPUT_DIR = resolve(PKG_ROOT, '..', 'scraper', 'data', 'raw');
const DEFAULT_WORK_DIR = resolve(PKG_ROOT, 'data');

/**
 * Parse CLI arguments into a typed configuration object.
 * Exported for testing; also used as the main entry point.
 */
export function parseCliArgs(argv: string[]): CliConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      stage: { type: 'string', default: 'all' },
      'dry-run': { type: 'boolean', default: false },
      'include-non-pd': { type: 'boolean', default: false },
      limit: { type: 'string' },
      'input-dir': { type: 'string' },
      'work-dir': { type: 'string' },
    },
    strict: true,
  });

  return {
    stage: (values.stage as Stage) ?? 'all',
    dryRun: values['dry-run'] ?? false,
    includeNonPd: values['include-non-pd'] ?? false,
    limit: values.limit ? parseInt(values.limit, 10) : undefined,
    inputDir: values['input-dir'] ?? DEFAULT_INPUT_DIR,
    workDir: values['work-dir'] ?? DEFAULT_WORK_DIR,
  };
}

// --- Main entry point ---
if (import.meta.main) {
  const config = parseCliArgs(process.argv.slice(2));
  const pipelineStartMs = performance.now();

  console.log('@sanctuary/etl pipeline');
  console.log('─'.repeat(40));
  console.log(`  Stage:          ${config.stage}`);
  console.log(`  Input dir:      ${config.inputDir}`);
  console.log(`  Work dir:       ${config.workDir}`);
  console.log(`  Dry run:        ${config.dryRun}`);
  console.log(`  Include non-PD: ${config.includeNonPd}`);
  console.log(`  Limit:          ${config.limit ?? '(none)'}`);
  console.log('─'.repeat(40));

  const runAll = config.stage === 'all';

  if (runAll || config.stage === 'clean') {
    stageStart(1, 'Clean');
    const summary = await runCleanStage(config);
    stageEnd('Clean', {
      read: summary.read,
      valid: summary.valid,
      skipped: summary.skipped,
      written: summary.written,
    });
  }

  if (runAll || config.stage === 'dedup') {
    stageStart(2, 'Deduplicate');
    const summary = await runDedupStage(config);
    stageEnd('Deduplicate', {
      read: summary.read,
      groups: summary.groups,
      duplicatesDropped: summary.duplicatesDropped,
      written: summary.written,
    });
  }

  if (runAll || config.stage === 'tag') {
    stageStart(3, 'Tag');
    const summary = await runTagStage(config);
    stageEnd('Tag', {
      read: summary.read,
      tagged: summary.tagged,
      fallback: summary.fallback,
      written: summary.written,
    });
  }

  if (runAll || config.stage === 'load') {
    stageStart(4, 'Load');

    // Load .env for database configuration
    loadEnv({ path: resolve(PKG_ROOT, '.env') });
    const dbConfig = resolveDbConfig();
    const db = createDb(dbConfig);

    const summary = await runLoadStage(config, db);
    stageEnd('Load', {
      read: summary.read,
      loaded: summary.loaded,
      skippedNonPd: summary.skippedNonPd,
      topicsUpserted: summary.topicsUpserted,
    });
  }

  const totalElapsedMs = performance.now() - pipelineStartMs;
  pipelineSummary(totalElapsedMs);
}
