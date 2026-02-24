import { describe, expect, test } from 'bun:test';
import { buildPrompt, loadSystemInstructions, type PromptOptions } from './prompt-builder';

describe('buildPrompt', () => {
  test('embeds topic and target line count in prompt body', () => {
    const options: PromptOptions = {
      topic: 'The sea',
      targetLineCount: 14,
    };

    const prompt = buildPrompt(options);

    expect(prompt).toContain('The sea');
    expect(prompt).toContain('14');
  });

  test('renders exact tolerance window instruction for the target line count', () => {
    const options: PromptOptions = {
      topic: 'Nature',
      targetLineCount: 9,
    };

    const prompt = buildPrompt(options);

    expect(prompt).toContain('between 7 and 11 lines (target: 9 lines, ±20% tolerance).');
  });

  test('includes style guidance to avoid generic AI phrasing', () => {
    const options: PromptOptions = {
      topic: 'Love',
      targetLineCount: 8,
    };

    const prompt = buildPrompt(options);

    expect(prompt).toContain('Write in a literary, evocative style');
    expect(prompt).toContain('Avoid clichés and generic phrases');
  });

  test('enforces JSON-only output format with escaped newline semantics', () => {
    const options: PromptOptions = {
      topic: 'Death',
      targetLineCount: 16,
    };

    const prompt = buildPrompt(options);

    expect(prompt).toContain('Respond ONLY with valid JSON');
    expect(prompt).toContain('"title": "Your poem title"');
    expect(prompt).toContain('"content": "The full poem text with line breaks represented as \\n"');
  });

  test('adds original poem title context only when provided', () => {
    const withContext = buildPrompt({
      topic: 'Memory',
      targetLineCount: 10,
      originalPoemTitle: 'Ode to Autumn',
    });

    const withoutContext = buildPrompt({
      topic: 'Memory',
      targetLineCount: 10,
    });

    expect(withContext).toContain('This poem is inspired by/related to: "Ode to Autumn".');
    expect(withoutContext).not.toContain('This poem is inspired by/related to:');
  });
});

describe('loadSystemInstructions', () => {
  test('loads system instructions as non-empty text', () => {
    const instructions = loadSystemInstructions();

    expect(instructions).toBeDefined();
    expect(typeof instructions).toBe('string');
    expect(instructions.length).toBeGreaterThan(0);
  });

  test('contains strict JSON response contract in system instructions', () => {
    const instructions = loadSystemInstructions();

    expect(instructions).toContain('Return ONLY valid JSON');
    expect(instructions).toContain('"title"');
    expect(instructions).toContain('"content"');
  });
});
