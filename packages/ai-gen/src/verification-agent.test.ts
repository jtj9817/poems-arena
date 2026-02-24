import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { verifyPoem, type PoemVerificationResult, VerificationError } from './verification-agent';

const mockVerifyContent = mock(() => {
  return Promise.resolve({
    text: JSON.stringify({
      isValid: true,
      score: 85,
      feedback: 'The poem has strong imagery and emotional resonance.',
    }),
  });
});

mock.module('@google/genai', () => ({
  GoogleGenAI: mock(() => ({
    models: {
      generateContent: mockVerifyContent,
    },
  })),
}));

describe('verifyPoem', () => {
  beforeEach(() => {
    mockVerifyContent.mockClear();
  });

  test('builds verification request payload with default model and strict JSON config', async () => {
    const poem = {
      title: 'Test Poem',
      content: 'Line one\nLine two\nLine three\nLine four',
    };

    const result = await verifyPoem({
      poem,
      apiKey: 'test-api-key',
    });

    expect(result).toEqual({
      isValid: true,
      score: 85,
      feedback: 'The poem has strong imagery and emotional resonance.',
    });
    expect(mockVerifyContent).toHaveBeenCalledTimes(1);

    const request = mockVerifyContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };

    expect(request.model).toBe('gemini-3-flash-preview');
    expect(request.contents).toContain(`Title: ${poem.title}`);
    expect(request.contents).toContain(poem.content);
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.temperature).toBe(0.7);
    expect(request.config.systemInstruction).toContain('You are a poem quality reviewer.');
    expect(request.config.responseSchema).toEqual({
      type: 'object',
      properties: {
        isValid: { type: 'boolean' },
        score: { type: 'number' },
        feedback: { type: 'string' },
      },
      required: ['isValid', 'score', 'feedback'],
    });
  });

  test('uses provided model override when supplied', async () => {
    await verifyPoem({
      poem: {
        title: 'Custom model test',
        content: 'line one\nline two\nline three\nline four',
      },
      apiKey: 'test-api-key',
      model: 'gemini-3-flash-preview-variant',
    });

    const request = mockVerifyContent.mock.calls[0]?.[0] as {
      model: string;
    };
    expect(request.model).toBe('gemini-3-flash-preview-variant');
  });

  test('throws VerificationError on empty response', async () => {
    mockVerifyContent.mockResolvedValueOnce({
      text: '',
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Empty response test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
      }),
    ).rejects.toThrow('Empty response from verification API');
  });

  test('throws VerificationError on malformed JSON response', async () => {
    mockVerifyContent.mockResolvedValueOnce({
      text: '{"isValid": true',
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Malformed json test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
      }),
    ).rejects.toThrow(VerificationError);
  });

  test('throws VerificationError on invalid response shape', async () => {
    mockVerifyContent.mockResolvedValueOnce({
      text: JSON.stringify({
        isValid: true,
        score: 91,
      }),
    });

    await expect(
      verifyPoem({
        poem: {
          title: 'Invalid shape test',
          content: 'line one\nline two\nline three\nline four',
        },
        apiKey: 'test-api-key',
      }),
    ).rejects.toThrow('Invalid verification response format');
  });

  test('throws VerificationError when provider call fails', async () => {
    mockVerifyContent.mockRejectedValueOnce(new Error('API Error'));

    await expect(
      verifyPoem({
        poem: {
          title: 'Test',
          content: 'Test content',
        },
        apiKey: 'invalid-key',
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
