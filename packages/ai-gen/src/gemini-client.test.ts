import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { generatePoem, type GeminiConfig, PoemGenerationError } from './gemini-client';

const mockGenerateContent = mock(async () => {
  return {
    text: JSON.stringify({
      title: 'Test Poem',
      content: 'Line one\nLine two\nLine three\nLine four',
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

  test('builds Gemini request using default model/config when optional values are omitted', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      systemInstructions: 'You are a poet.',
    };

    const result = await generatePoem({
      prompt: 'Write about the sea',
      config,
    });

    expect(result).toEqual({
      title: 'Test Poem',
      content: 'Line one\nLine two\nLine three\nLine four',
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const request = mockGenerateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };

    expect(request.model).toBe('gemini-3-flash-preview');
    expect(request.contents).toBe('Write about the sea');
    expect(request.config.temperature).toBe(1.0);
    expect(request.config.systemInstruction).toBe('You are a poet.');
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.responseSchema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
    });
    expect('thinkingConfig' in request.config).toBe(false);
    expect('maxOutputTokens' in request.config).toBe(false);
  });

  test('uses provided model and optional generation config fields', async () => {
    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-3-flash-preview',
      systemInstructions: 'You are a poet.',
      temperature: 0.8,
      thinkingConfig: {
        thinkingBudget: 128,
      },
      maxOutputTokens: 1024,
    };

    await generatePoem({
      prompt: 'Write about death',
      config,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request = mockGenerateContent.mock.calls[0]?.[0] as {
      model: string;
      config: Record<string, unknown>;
    };

    expect(request.model).toBe('gemini-3-flash-preview');
    expect(request.config.temperature).toBe(0.8);
    expect(request.config.thinkingConfig).toEqual({ thinkingBudget: 128 });
    expect(request.config.maxOutputTokens).toBe(1024);
  });

  test('throws PoemGenerationError on empty response text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '',
    });

    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-3-flash-preview',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about anything',
        config,
      }),
    ).rejects.toThrow('Empty response from Gemini API');
  });

  test('throws PoemGenerationError on malformed JSON response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '{"title":"Broken"',
    });

    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about stars',
        config,
      }),
    ).rejects.toThrow(PoemGenerationError);
  });

  test('throws PoemGenerationError when JSON shape is missing required fields', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'Untitled',
      }),
    });

    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about rain',
        config,
      }),
    ).rejects.toThrow('Invalid response format: missing title or content');
  });

  test('wraps provider failures in PoemGenerationError', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('transport failure'));

    const config: GeminiConfig = {
      apiKey: 'test-api-key',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about silence',
        config,
      }),
    ).rejects.toThrow(PoemGenerationError);
  });
});
