import { expect, test, describe, mock, beforeEach } from 'bun:test';
import { generatePoem, GeminiConfig, PoemGenerationError } from './gemini-client';

const mockGenerateContent = mock(() => {
  return {
    text: JSON.stringify({
      title: 'Test Poem',
      content: 'Line one\nLine two\nLine three',
    }),
  };
});

mock.module('@google/genai', () => ({
  GoogleGenAI: mock(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('generatePoem', () => {
  beforeEach(() => {
    mockGenerateContent.mockClear();
  });

  test('should generate poem with correct structure', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-preview',
      systemInstructions: 'You are a poet.',
    };

    const result = await generatePoem({
      prompt: 'Write about the sea',
      config,
    });

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('content');
    expect(typeof result.title).toBe('string');
    expect(typeof result.content).toBe('string');
  });

  test('should use JSON mode for response', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-preview',
      systemInstructions: 'You are a poet.',
    };

    const result = await generatePoem({
      prompt: 'Write about nature',
      config,
    });

    expect(result.title.length).toBeGreaterThan(0);
    expect(result.content.length).toBeGreaterThan(0);
  });

  test('should respect temperature setting', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-preview',
      systemInstructions: 'You are a poet.',
      temperature: 0.8,
    };

    const result = await generatePoem({
      prompt: 'Write about love',
      config,
    });

    expect(result).toBeDefined();
  });

  test('should include thinking config when provided', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-preview',
      systemInstructions: 'You are a poet.',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    };

    const result = await generatePoem({
      prompt: 'Write about death',
      config,
    });

    expect(result).toBeDefined();
  });

  test('should throw PoemGenerationError on empty response', async () => {
    mockGenerateContent.mockReturnValueOnce({
      text: '',
    });

    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-preview',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about anything',
        config,
      }),
    ).rejects.toThrow(PoemGenerationError);
  });
});

describe('GeminiConfig', () => {
  test('should allow custom model override', () => {
    const config: GeminiConfig = {
      apiKey: 'test-key',
      systemInstructions: 'Test',
      model: 'gemini-1.5-pro',
    };

    expect(config.model).toBe('gemini-1.5-pro');
  });
});
