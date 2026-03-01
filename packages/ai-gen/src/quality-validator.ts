import type { PoemOutput } from './deepseek-client';
import type { PoemVerificationResult } from './verification-agent';

const MINIMUM_LINE_COUNT = 4;
const LINE_COUNT_TOLERANCE_PERCENT = 20;
const DEFAULT_MIN_VERIFICATION_SCORE = 70;

const META_TEXT_PATTERNS: RegExp[] = [
  /\bhere(?:'s| is) (?:an? )?poem\b/i,
  /\bi hope you enjoy\b/i,
  /\bas an ai\b/i,
  /\bi (?:can|will|shall) write\b.*\bpoem\b/i,
  /\bthis poem (?:explores|is about)\b/i,
  /\bbelow is (?:an? )?poem\b/i,
];

export type QualityIssue =
  | 'invalid_output_shape'
  | 'line_count_below_minimum'
  | 'line_count_out_of_range'
  | 'contains_meta_text'
  | 'verification_below_threshold'
  | 'verification_marked_invalid';

export interface QualityValidatorParams {
  generatedPoem: PoemOutput;
  parentLineCount: number;
  verification?: PoemVerificationResult;
  minVerificationScore?: number;
}

export interface QualityValidationMetrics {
  lineCount: number;
  allowedLineCountMin: number;
  allowedLineCountMax: number;
}

export interface QualityValidationResult {
  isValid: boolean;
  shouldRetry: boolean;
  issues: QualityIssue[];
  metrics: QualityValidationMetrics;
}

function countNonEmptyLines(content: string): number {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function calculateLineCountRange(parentLineCount: number): { min: number; max: number } {
  const min = parentLineCount * (1 - LINE_COUNT_TOLERANCE_PERCENT / 100);
  const max = parentLineCount * (1 + LINE_COUNT_TOLERANCE_PERCENT / 100);
  return { min, max };
}

function hasMetaText(content: string): boolean {
  return META_TEXT_PATTERNS.some((pattern) => pattern.test(content));
}

function hasValidOutputShape(generatedPoem: unknown): generatedPoem is PoemOutput {
  if (typeof generatedPoem !== 'object' || generatedPoem === null) {
    return false;
  }

  const candidate = generatedPoem as { title?: unknown; content?: unknown };

  return (
    typeof candidate.title === 'string' &&
    candidate.title.trim().length > 0 &&
    typeof candidate.content === 'string' &&
    candidate.content.trim().length > 0
  );
}

export function validateGeneratedPoemQuality(
  params: QualityValidatorParams,
): QualityValidationResult {
  const { generatedPoem, parentLineCount, verification } = params;
  const minVerificationScore = params.minVerificationScore ?? DEFAULT_MIN_VERIFICATION_SCORE;
  const { min: allowedLineCountMin, max: allowedLineCountMax } =
    calculateLineCountRange(parentLineCount);
  const issues: QualityIssue[] = [];
  const isOutputShapeValid = hasValidOutputShape(generatedPoem);

  if (!isOutputShapeValid) {
    issues.push('invalid_output_shape');
  }

  const content = isOutputShapeValid ? generatedPoem.content : '';
  const lineCount = countNonEmptyLines(content);

  if (lineCount < MINIMUM_LINE_COUNT) {
    issues.push('line_count_below_minimum');
  }

  if (lineCount < allowedLineCountMin || lineCount > allowedLineCountMax) {
    issues.push('line_count_out_of_range');
  }

  if (hasMetaText(content)) {
    issues.push('contains_meta_text');
  }

  if (verification && verification.isValid === false) {
    issues.push('verification_marked_invalid');
  }

  if (verification && verification.score < minVerificationScore) {
    issues.push('verification_below_threshold');
  }

  const nonRetryableIssues: QualityIssue[] = ['invalid_output_shape'];
  const hasNonRetryableIssue = issues.some((issue) => nonRetryableIssues.includes(issue));

  return {
    isValid: issues.length === 0,
    shouldRetry: issues.length > 0 && !hasNonRetryableIssue,
    issues,
    metrics: {
      lineCount,
      allowedLineCountMin,
      allowedLineCountMax,
    },
  };
}
