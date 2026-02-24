/**
 * AI Poem Generation Service
 *
 * This package provides AI-powered poem generation using Google's Gemini API.
 * It generates AI counterparts to human poems based on topics and line counts.
 */

export { buildPrompt, loadSystemInstructions, PromptOptions } from './prompt-builder';
export {
  generatePoem,
  GeminiConfig,
  PoemOutput,
  PoemGenerationError,
  ThinkingConfig,
  GeneratePoemParams,
} from './gemini-client';
export {
  verifyPoem,
  PoemVerificationResult,
  VerificationError,
  VerifyPoemParams,
} from './verification-agent';

export const AI_GEN_VERSION = '0.1.0';
