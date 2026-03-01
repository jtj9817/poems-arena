import { buildPrompt } from './prompt-builder';
import { generatePoem } from './deepseek-client';
import { validateGeneratedPoemQuality } from './quality-validator';
import { verifyPoem } from './verification-agent';
import type { HumanPoemCandidate, PersistedAiPoem, PersistenceDb } from './persistence';
import { persistGeneratedPoem } from './persistence';

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TOPIC = 'classical reflection';
const DEFAULT_MAX_RETRIES = 2;

function countNonEmptyLines(content: string): number {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export type GenerationOutcome = 'stored' | 'skipped' | 'failed';

export interface GenerateCounterpartParams {
  db: PersistenceDb;
  parentPoem: HumanPoemCandidate;
  apiKey: string;
  systemInstructions: string;
  model?: string;
  topic?: string;
  maxRetries?: number;
}

export interface GenerateCounterpartResult {
  poemId: string;
  status: GenerationOutcome;
  attempts: number;
  storedPoem?: PersistedAiPoem;
  reason?: string;
}

export async function generateCounterpartForPoem(
  params: GenerateCounterpartParams,
): Promise<GenerateCounterpartResult> {
  const model = params.model ?? DEFAULT_MODEL;
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  const parentLineCount = Math.max(countNonEmptyLines(params.parentPoem.content), 4);
  const topic = params.topic ?? DEFAULT_TOPIC;
  const prompt = buildPrompt({
    topic,
    targetLineCount: parentLineCount,
    originalPoemTitle: params.parentPoem.title,
  });

  let attempt = 0;
  let lastReason = 'unknown_failure';

  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      const generated = await generatePoem({
        prompt,
        config: {
          apiKey: params.apiKey,
          model,
          systemInstructions: params.systemInstructions,
        },
      });

      const verification = await verifyPoem({
        poem: generated,
        apiKey: params.apiKey,
        model,
      });

      const validation = validateGeneratedPoemQuality({
        generatedPoem: generated,
        parentLineCount,
        verification,
      });

      if (!validation.isValid) {
        lastReason = validation.issues.join(',');
        if (!validation.shouldRetry) {
          return {
            poemId: params.parentPoem.id,
            status: 'skipped',
            attempts: attempt,
            reason: lastReason,
          };
        }
        continue;
      }

      const storedPoem = await persistGeneratedPoem({
        db: params.db,
        parentPoem: params.parentPoem,
        generatedPoem: generated,
        prompt,
        model,
      });

      return {
        poemId: params.parentPoem.id,
        status: 'stored',
        attempts: attempt,
        storedPoem,
      };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    poemId: params.parentPoem.id,
    status: 'failed',
    attempts: attempt,
    reason: lastReason,
  };
}
