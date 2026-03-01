import { createDb, resolveDbConfig } from '@sanctuary/db';
import { parseCliArgs, runGenerationCli, type CliDependencies } from './cli';
import { assembleAndPersistDuels, type PersistenceDb as DuelAssemblyDb } from './duel-assembly';
import {
  generateCounterpartForPoem,
  type GenerateCounterpartResult,
  type GenerateCounterpartParams,
} from './generation-service';
import { fetchUnmatchedHumanPoems, type PersistenceDb } from './persistence';
import { loadSystemInstructions } from './prompt-builder';

/**
 * AI Poem Generation Service
 *
 * This package provides AI-powered poem generation using DeepSeek's API.
 * It generates AI counterparts to human poems based on topics and line counts.
 */

export { buildPrompt, loadSystemInstructions, type PromptOptions } from './prompt-builder';
export {
  generatePoem,
  type DeepSeekConfig,
  type PoemOutput,
  PoemGenerationError,
  type GeneratePoemParams,
} from './deepseek-client';
export {
  verifyPoem,
  type PoemVerificationResult,
  VerificationError,
  type VerifyPoemParams,
} from './verification-agent';
export {
  validateGeneratedPoemQuality,
  type QualityIssue,
  type QualityValidatorParams,
  type QualityValidationMetrics,
  type QualityValidationResult,
} from './quality-validator';
export {
  fetchUnmatchedHumanPoems,
  buildAiPoemInsertValues,
  persistGeneratedPoem,
  type HumanPoemCandidate,
  type PersistedAiPoem,
} from './persistence';
export {
  assemblePairs,
  assembleAndPersistDuels,
  fetchPoemsWithTopics,
  fetchExistingDuelIds,
  persistDuelCandidates,
  type DuelCandidate,
  type PoemWithTopics,
  type TopicInfo,
  type AssemblePairsOptions,
} from './duel-assembly';
export {
  generateCounterpartForPoem,
  type GenerateCounterpartParams,
  type GenerateCounterpartResult,
  type GenerationOutcome,
} from './generation-service';
export {
  parseCliArgs,
  runGenerationCli,
  type CliConfig,
  type CliDependencies,
  type CliRunSummary,
  type ProcessPoemResult,
  type AssemblyRunResult,
} from './cli';

export const AI_GEN_VERSION = '0.2.0';

function resolveApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DeepSeek API key. Set DEEPSEEK_API_KEY.');
  }
  return apiKey;
}

function mapGenerationResult(result: GenerateCounterpartResult): {
  poemId: string;
  status: 'stored' | 'skipped' | 'failed';
  storedPoemId?: string;
  reason?: string;
} {
  if (result.status === 'stored') {
    return {
      poemId: result.poemId,
      status: 'stored',
      storedPoemId: result.storedPoem?.id,
    };
  }

  if (result.status === 'skipped') {
    return {
      poemId: result.poemId,
      status: 'skipped',
      reason: result.reason,
    };
  }

  return {
    poemId: result.poemId,
    status: 'failed',
    reason: result.reason,
  };
}

export function createDefaultCliDependencies(
  env: NodeJS.ProcessEnv = process.env,
): CliDependencies {
  const dbConfig = resolveDbConfig(env);
  const db = createDb(dbConfig);
  const rawClient = (db as { $client?: unknown }).$client as
    | {
        execute: (statement: { sql: string; args?: unknown[] }) => Promise<{
          rows?: Array<Record<string, unknown>>;
          rowsAffected?: number;
        }>;
      }
    | undefined;
  if (!rawClient || typeof rawClient.execute !== 'function') {
    throw new Error('Unable to access LibSQL client for ai-gen persistence operations.');
  }

  const persistenceDb: PersistenceDb & DuelAssemblyDb = {
    execute: async (query: string, params?: unknown[]) => {
      const result = await rawClient.execute({
        sql: query,
        args: params ?? [],
      });
      return { rows: result.rows ?? [], rowsAffected: result.rowsAffected };
    },
  };

  const apiKey = resolveApiKey(env);
  const systemInstructions = loadSystemInstructions();

  return {
    fetchPoems: async (config) =>
      fetchUnmatchedHumanPoems({
        db: persistenceDb,
        topic: config.topic,
        limit: config.limit,
      }),
    processPoem: async (poem, config) => {
      const params: GenerateCounterpartParams = {
        db: persistenceDb,
        parentPoem: poem,
        apiKey,
        systemInstructions,
        model: config.model,
        topic: config.topic,
        maxRetries: config.maxRetries,
      };
      const result = await generateCounterpartForPoem(params);
      return mapGenerationResult(result);
    },
    assembleAfterRun: async () => assembleAndPersistDuels(persistenceDb),
    log: (line: string) => {
      console.log(line);
    },
  };
}

if (import.meta.main) {
  const config = parseCliArgs(process.argv.slice(2));
  const dependencies = createDefaultCliDependencies();
  await runGenerationCli(config, dependencies);
}
