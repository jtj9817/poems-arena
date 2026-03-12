import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  generatePoem,
  getDeepSeekClient,
  type DeepSeekConfig,
  PoemGenerationError,
  sanitizeJsonContent,
} from './deepseek-client';

const mockCreateCompletion = mock(async () => ({
  choices: [
    {
      message: {
        content: JSON.stringify({
          title: 'Test Poem',
          content: 'Line one\nLine two\nLine three\nLine four',
          isValid: true,
          score: 85,
          feedback: 'The poem has strong imagery and emotional resonance.',
        }),
      },
    },
  ],
}));

const mockOpenAIConstructor = mock((_options: unknown) => ({
  chat: {
    completions: {
      create: mockCreateCompletion,
    },
  },
}));

mock.module('openai', () => ({
  default: mockOpenAIConstructor,
}));

describe('generatePoem', () => {
  beforeEach(() => {
    mockCreateCompletion.mockClear();
    mockOpenAIConstructor.mockClear();
  });

  test('builds DeepSeek request using default model/config when optional values are omitted', async () => {
    const config: DeepSeekConfig = {
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
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);

    const request = mockCreateCompletion.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      temperature: number;
      max_tokens: number;
    };

    expect(request.model).toBe('deepseek-chat');
    expect(request.messages[0]).toEqual({ role: 'system', content: 'You are a poet.' });
    expect(request.messages[1]?.content).toContain('Write about the sea');
    expect(request.messages[1]?.content).toContain('Respond in JSON format.');
    expect(request.response_format.type).toBe('json_object');
    expect(request.temperature).toBe(1.5);
    expect(request.max_tokens).toBe(2048);
  });

  test('uses provided model and optional generation config fields', async () => {
    const config: DeepSeekConfig = {
      apiKey: 'test-api-key',
      model: 'deepseek-chat-alt',
      systemInstructions: 'You are a poet.',
      temperature: 0.8,
      maxOutputTokens: 1024,
    };

    await generatePoem({
      prompt: 'Write about death',
      config,
    });

    const request = mockCreateCompletion.mock.calls[0]?.[0] as {
      model: string;
      temperature: number;
      max_tokens: number;
    };

    expect(request.model).toBe('deepseek-chat-alt');
    expect(request.temperature).toBe(0.8);
    expect(request.max_tokens).toBe(1024);
  });

  test('throws PoemGenerationError on empty response text', async () => {
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    const config: DeepSeekConfig = {
      apiKey: 'test-api-key',
      model: 'deepseek-chat',
      systemInstructions: 'You are a poet.',
    };

    await expect(
      generatePoem({
        prompt: 'Write about anything',
        config,
      }),
    ).rejects.toThrow('Empty response from DeepSeek API');
  });

  test('throws PoemGenerationError on malformed JSON response', async () => {
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"title":"Broken"' } }],
    });

    const config: DeepSeekConfig = {
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
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: 'Untitled' }) } }],
    });

    const config: DeepSeekConfig = {
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

  test('parses JSON wrapped in markdown fences', async () => {
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```json\n{"title":"Fenced","content":"line1\\nline2\\nline3\\nline4"}\n```',
          },
        },
      ],
    });

    const config: DeepSeekConfig = {
      apiKey: 'test-api-key',
      systemInstructions: 'You are a poet.',
    };

    const result = await generatePoem({ prompt: 'Write about fog', config });

    expect(result.title).toBe('Fenced');
  });

  test('wraps provider failures in PoemGenerationError', async () => {
    mockCreateCompletion.mockRejectedValueOnce(new Error('transport failure'));

    const config: DeepSeekConfig = {
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

describe('getDeepSeekClient', () => {
  test('reuses singleton client instance per API key', async () => {
    const first = await getDeepSeekClient('k1');
    const second = await getDeepSeekClient('k1');
    const third = await getDeepSeekClient('k2');

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(2);
  });

  test('configures client with DeepSeek base URL, timeout, and retries', async () => {
    await getDeepSeekClient('k-config-test');

    const options = mockOpenAIConstructor.mock.calls.at(-1)?.[0] as {
      baseURL: string;
      apiKey: string;
      timeout: number;
      maxRetries: number;
    };

    expect(options.baseURL).toBe('https://api.deepseek.com/v1');
    expect(typeof options.apiKey).toBe('string');
    expect(options.timeout).toBe(30000);
    expect(options.maxRetries).toBe(2);
  });
});

describe('sanitizeJsonContent', () => {
  test('strips markdown fences and trims whitespace', () => {
    expect(sanitizeJsonContent('  ```json\n{"ok":true}\n```  ')).toBe('{"ok":true}');
  });
});
