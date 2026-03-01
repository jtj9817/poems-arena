import { describe, expect, test } from 'bun:test';
import type { PoemOutput } from './deepseek-client';
import type { PoemVerificationResult } from './verification-agent';
import { validateGeneratedPoemQuality } from './quality-validator';

function poem(content: string, title = 'Generated Title'): PoemOutput {
  return { title, content };
}

function numberedLines(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('validateGeneratedPoemQuality', () => {
  test('rejects poems with fewer than 4 non-empty lines', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('line one\nline two\nline three'),
      parentLineCount: 10,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('line_count_below_minimum');
  });

  test('rejects poems outside the +/-20% parent line-count tolerance', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13'),
      parentLineCount: 10,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('line_count_out_of_range');
  });

  test('enforces strict +/-20% tolerance without widening the range', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('1\n2\n3\n4\n5\n6\n7\n8'),
      parentLineCount: 6,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('line_count_out_of_range');
    expect(result.metrics.allowedLineCountMax).toBeCloseTo(7.2, 10);
  });

  test('rejects poems containing meta-text conversational fillers', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(
        'Here is a poem about starlight\nmoonlight spills\na quiet shore\ndawn arrives',
      ),
      parentLineCount: 4,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('contains_meta_text');
  });

  test('rejects poems that fail basic output shape validation', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('line one\nline two\nline three\nline four', '   '),
      parentLineCount: 4,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(false);
    expect(result.issues).toContain('invalid_output_shape');
  });

  test('returns invalid_output_shape for malformed runtime input instead of throwing', () => {
    const malformedPoem = { title: 'Generated Title' } as unknown as PoemOutput;

    const result = validateGeneratedPoemQuality({
      generatedPoem: malformedPoem,
      parentLineCount: 4,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(false);
    expect(result.issues).toContain('invalid_output_shape');
  });

  test('rejects poems that fail verification threshold checks', () => {
    const verification: PoemVerificationResult = {
      isValid: true,
      score: 59,
      feedback: 'Needs stronger imagery',
    };

    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('line one\nline two\nline three\nline four'),
      parentLineCount: 4,
      verification,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('verification_below_threshold');
  });

  test('accepts poems that satisfy all quality checks', () => {
    const verification: PoemVerificationResult = {
      isValid: true,
      score: 88,
      feedback: 'Strong poem',
    };

    const result = validateGeneratedPoemQuality({
      generatedPoem: poem('line one\nline two\nline three\nline four\nline five'),
      parentLineCount: 6,
      verification,
    });

    expect(result.isValid).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.metrics.lineCount).toBe(5);
  });

  test('accepts poems exactly at lower tolerance boundary', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(4)),
      parentLineCount: 5,
    });

    expect(result.isValid).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.metrics.allowedLineCountMin).toBe(4);
    expect(result.issues).toEqual([]);
  });

  test('accepts poems exactly at upper tolerance boundary', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(6)),
      parentLineCount: 5,
    });

    expect(result.isValid).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.metrics.allowedLineCountMax).toBe(6);
    expect(result.issues).toEqual([]);
  });

  test('rejects poems just below lower tolerance boundary', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(3)),
      parentLineCount: 5,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toEqual(['line_count_below_minimum', 'line_count_out_of_range']);
  });

  test('rejects poems just above upper tolerance boundary', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(7)),
      parentLineCount: 5,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toEqual(['line_count_out_of_range']);
  });

  test('marks verification_marked_invalid when verifier flags invalid output', () => {
    const verification: PoemVerificationResult = {
      isValid: false,
      score: 95,
      feedback: 'Verifier rejected for coherence concerns',
    };

    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(4)),
      parentLineCount: 4,
      verification,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('verification_marked_invalid');
    expect(result.issues).not.toContain('verification_below_threshold');
  });

  test('reports both verification issues when invalid and below threshold', () => {
    const verification: PoemVerificationResult = {
      isValid: false,
      score: 55,
      feedback: 'Not acceptable',
    };

    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(numberedLines(4)),
      parentLineCount: 4,
      verification,
    });

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.issues).toContain('verification_marked_invalid');
    expect(result.issues).toContain('verification_below_threshold');
  });

  test('does not flag non-meta poetic phrasing that includes "here is"', () => {
    const result = validateGeneratedPoemQuality({
      generatedPoem: poem(
        'Here is rain on marble steps\nA gull turns once above the quay\nRust tastes bright along the rail\nNight folds quietly into dawn',
      ),
      parentLineCount: 4,
    });

    expect(result.isValid).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.issues).toEqual([]);
  });

  test('sets shouldRetry=false when invalid_output_shape appears with retryable issues', () => {
    const malformedPoem = { title: 'Only a title' } as unknown as PoemOutput;

    const result = validateGeneratedPoemQuality({
      generatedPoem: malformedPoem,
      parentLineCount: 10,
    });

    expect(result.isValid).toBe(false);
    expect(result.issues).toContain('invalid_output_shape');
    expect(result.issues).toContain('line_count_below_minimum');
    expect(result.issues).toContain('line_count_out_of_range');
    expect(result.shouldRetry).toBe(false);
  });
});
