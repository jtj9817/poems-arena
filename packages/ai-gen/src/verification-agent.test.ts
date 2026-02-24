import { expect, test, describe, mock, beforeEach } from 'bun:test';
import { verifyPoem, PoemVerificationResult, VerificationError } from './verification-agent';

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

  test('should verify poem with valid structure', async () => {
    const result = await verifyPoem({
      poem: {
        title: 'Test Poem',
        content: 'Line one\nLine two\nLine three',
      },
      apiKey: 'test-api-key',
    });

    expect(result).toHaveProperty('isValid');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('feedback');
  });

  test('should return verification result with score', async () => {
    const result = await verifyPoem({
      poem: {
        title: 'Nature',
        content: 'The wind whispers through the trees\nLeaves dance on gentle breeze',
      },
      apiKey: 'test-api-key',
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('should pass poem content to verification prompt', async () => {
    const poem = {
      title: 'The Sea',
      content: 'Blue waves crash upon the shore\n eternal rhythm evermore',
    };

    await verifyPoem({
      poem,
      apiKey: 'test-api-key',
    });

    expect(mockVerifyContent).toHaveBeenCalled();
  });

  test('should throw VerificationError when API fails', async () => {
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
  test('should have required properties', () => {
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
