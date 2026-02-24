export interface PoemVerificationResult {
  isValid: boolean;
  score: number;
  feedback: string;
}

export class VerificationError extends Error {
  constructor(
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}

const VERIFICATION_MODEL = 'gemini-3-flash-preview';

const VERIFICATION_SYSTEM_INSTRUCTION = `You are a poem quality reviewer. Evaluate poems based on:
1. Literary quality - imagery, metaphor, rhythm
2. Originality - avoiding clichés and generic phrases
3. Emotional resonance - does it evoke feeling?
4. Technical skill - line breaks, structure, language use

Respond ONLY with valid JSON in the following format:
{
  "isValid": true or false,
  "score": number between 0-100,
  "feedback": "brief constructive feedback"
}`;

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    isValid: { type: 'boolean' },
    score: { type: 'number' },
    feedback: { type: 'string' },
  },
  required: ['isValid', 'score', 'feedback'],
};

export interface VerifyPoemParams {
  poem: {
    title: string;
    content: string;
  };
  apiKey: string;
  model?: string;
}

export async function verifyPoem(params: VerifyPoemParams): Promise<PoemVerificationResult> {
  const { poem, apiKey, model = VERIFICATION_MODEL } = params;

  const verificationPrompt = `Please evaluate the following poem:

Title: ${poem.title}

${poem.content}

Provide your evaluation in JSON format.`;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });

    const result = await client.models.generateContent({
      model,
      contents: verificationPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: VERIFICATION_SCHEMA,
        temperature: 0.7,
        systemInstruction: VERIFICATION_SYSTEM_INSTRUCTION,
      },
    });

    const responseText = result.text;

    if (!responseText) {
      throw new VerificationError('Empty response from verification API');
    }

    const parsed = JSON.parse(responseText) as Partial<PoemVerificationResult> | null;

    if (
      !parsed ||
      typeof parsed.isValid !== 'boolean' ||
      typeof parsed.score !== 'number' ||
      typeof parsed.feedback !== 'string'
    ) {
      throw new VerificationError('Invalid verification response format');
    }

    return parsed as PoemVerificationResult;
  } catch (error) {
    if (error instanceof VerificationError) {
      throw error;
    }
    throw new VerificationError(
      `Failed to verify poem: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }
}
