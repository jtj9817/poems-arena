import { expect, test, describe } from 'bun:test';
import { buildPrompt, loadSystemInstructions, PromptOptions } from './prompt-builder';

describe('buildPrompt', () => {
  test('should generate a prompt with topic and target line count', () => {
    const options: PromptOptions = {
      topic: 'The sea',
      targetLineCount: 14,
    };

    const prompt = buildPrompt(options);

    expect(prompt).toContain('The sea');
    expect(prompt).toContain('14');
  });

  test('should include line count tolerance in prompt', () => {
    const options: PromptOptions = {
      topic: 'Nature',
      targetLineCount: 10,
    };

    const prompt = buildPrompt(options);

    // Should mention ±20% tolerance
    expect(prompt).toContain('±20%');
    expect(prompt).toContain('8');
    expect(prompt).toContain('12');
  });

  test('should include style instructions in prompt', () => {
    const options: PromptOptions = {
      topic: 'Love',
      targetLineCount: 8,
    };

    const prompt = buildPrompt(options);

    // Should include style guidance
    expect(prompt).toContain('poem');
    expect(prompt).toContain('line');
  });

  test('should include JSON output format instructions', () => {
    const options: PromptOptions = {
      topic: 'Death',
      targetLineCount: 16,
    };

    const prompt = buildPrompt(options);

    // Should specify JSON format
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('title');
    expect(prompt).toContain('content');
  });
});

describe('loadSystemInstructions', () => {
  test('should load system instructions from markdown file', async () => {
    const instructions = await loadSystemInstructions();

    expect(instructions).toBeDefined();
    expect(typeof instructions).toBe('string');
    expect(instructions.length).toBeGreaterThan(0);
  });

  test('should include poem generation guidelines in system instructions', async () => {
    const instructions = await loadSystemInstructions();

    // Should contain key guidelines
    expect(instructions).toContain('poem');
    expect(instructions).toContain('human');
  });
});
