import { describe, expect, test } from 'bun:test';
import type { PoemOutput } from './gemini-client';
import type { PoemVerificationResult } from './verification-agent';
import { validateGeneratedPoemQuality } from './quality-validator';

function poem(content: string, title = 'Generated Title'): PoemOutput {
  return { title, content };
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
});
