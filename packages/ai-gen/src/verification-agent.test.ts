import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { verifyPoem, type PoemVerificationResult, VerificationError } from './verification-agent';

const mockVerifyCompletion = mock(() => {
  return Promise.resolve({
    choices: [
      {
        message: {
          content: JSON.stringify({
            isValid: true,
            score: 85,
            feedback: 'The poem has strong imagery and emotional resonance.',
          }),
        },
      },
    ],
  });
});

function createMockClient() {
  return {
    chat: {
      completions: {
        create: mockVerifyCompletion,
      },
    },
  };
}

describe('verifyPoem', () => {
  beforeEach(() => {
    mockVerifyCompletion.mockClear();
  });

  test('builds verification request payload with default model and strict JSON config', async () => {
    const poem = {
      title: 'Test Poem',
      content: 'Line one\nLine two\nLine three\nLine four',
    };

    const result = await verifyPoem({
      poem,
      apiKey: 'test-api-key',
      client: createMockClient(),
    });

    expect(result).toEqual({
      isValid: true,
      score: 85,
      feedback: 'The poem has strong imagery and emotional resonance.',
    });
    expect(mockVerifyCompletion).toHaveBeenCalledTimes(1);

    const request = mockVerifyCompletion.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      temperature: number;
      max_tokens: number;
    };

    expect(request.model).toBe('deepseek-chat');
    expect(request.messages[0]?.content).toContain('You are a poem quality reviewer.');
    expect(request.messages[1]?.content).toContain(`Title: ${poem.title}`);
    expect(request.messages[1]?.content).toContain(poem.content);
    expect(request.response_format.type).toBe('json_object');
    expect(request.temperature).toBe(0.7);
    expect(request.max_tokens).toBe(1024);
  });

  test('uses provided model override when supplied', async () => {
    await verifyPoem({
      poem: {
        title: 'Custom model test',
        content: 'line one\nline two\nline three\nline four',
      },
      apiKey: 'test-api-key',
      model: 'deepseek-chat-variant',
      client: createMockClient(),
    });

    const request = mockVerifyCompletion.mock.calls[0]?.[0] as {
      model: string;
    };
    expect(request.model).toBe('deepseek-chat-variant');
  });

  test('throws VerificationError on empty response', async () => {
    mockVerifyCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Empty response test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
        client: createMockClient(),
      }),
    ).rejects.toThrow('Empty response from verification API');
  });

  test('throws VerificationError on malformed JSON response', async () => {
    mockVerifyCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"isValid": true' } }],
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Malformed json test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
        client: createMockClient(),
      }),
    ).rejects.toThrow(VerificationError);
  });

  test('parses verification JSON wrapped in markdown fences', async () => {
    mockVerifyCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```json\n{"isValid":true,"score":91,"feedback":"ok"}\n```',
          },
        },
      ],
    });

    const result = await verifyPoem({
      poem: {
        title: 'Fenced',
        content: 'line one\nline two\nline three\nline four',
      },
      apiKey: 'test-api-key',
      client: createMockClient(),
    });

    expect(result.score).toBe(91);
  });

  test('throws VerificationError on invalid response shape', async () => {
    mockVerifyCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ isValid: true, score: 91 }) } }],
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Invalid shape test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
        client: createMockClient(),
      }),
    ).rejects.toThrow('Invalid verification response format');
  });

  test('throws VerificationError when provider call fails', async () => {
    mockVerifyCompletion.mockRejectedValueOnce(new Error('API Error'));

    await expect(
      verifyPoem({
        poem: {
          title: 'Test',
          content: 'Test content',
        },
        apiKey: 'invalid-key',
        client: createMockClient(),
      }),
    ).rejects.toThrow(VerificationError);
  });
});

describe('PoemVerificationResult', () => {
  test('has required properties', () => {
    const result: PoemVerificationResult = {
      isValid: true,
      score: 90,
      feedback: 'Great poem!',
    };

    expect(result.isValid).toBe(true);
    expect(result.score).toBe(90);
    expect(result.feedback).toBe('Great poem!');
  });
});
