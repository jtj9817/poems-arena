import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

/**
 * Verifies that zod is installed and usable for ETL runtime validation.
 * These tests fail before `zod` is added as a dependency.
 */
describe('ETL runtime validation (zod)', () => {
  test('validates stage enum values', () => {
    const StageSchema = z.enum(['clean', 'dedup', 'tag', 'load', 'all']);
    expect(StageSchema.parse('clean')).toBe('clean');
    expect(StageSchema.parse('all')).toBe('all');
  });

  test('rejects invalid stage values', () => {
    const StageSchema = z.enum(['clean', 'dedup', 'tag', 'load', 'all']);
    expect(() => StageSchema.parse('invalid')).toThrow();
  });

  test('validates a numeric limit field', () => {
    const LimitSchema = z.number().int().positive();
    expect(LimitSchema.parse(50)).toBe(50);
    expect(() => LimitSchema.parse(-1)).toThrow();
    expect(() => LimitSchema.parse(0)).toThrow();
  });
});
