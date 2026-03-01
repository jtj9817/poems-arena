import { getDeepSeekClient, sanitizeJsonContent } from './deepseek-client';

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

const VERIFICATION_MODEL = 'deepseek-chat';

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

export interface VerifyPoemParams {
  poem: {
    title: string;
    content: string;
  };
  apiKey: string;
  model?: string;
  client?: {
    chat: {
      completions: {
        create: (params: {
          model: string;
          messages: Array<{ role: 'system' | 'user'; content: string }>;
          response_format: { type: 'json_object' };
          temperature: number;
          max_tokens: number;
        }) => Promise<{
          choices: Array<{
            message?: {
              content?: string | null;
            } | null;
          }>;
        }>;
      };
    };
  };
}

export async function verifyPoem(params: VerifyPoemParams): Promise<PoemVerificationResult> {
  const { poem, apiKey, model = VERIFICATION_MODEL } = params;

  const verificationPrompt = `Please evaluate the following poem:\n\nTitle: ${poem.title}\n\n${poem.content}\n\nProvide your evaluation in JSON format.`;

  try {
    const client = params.client ?? (await getDeepSeekClient(apiKey));

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: VERIFICATION_SYSTEM_INSTRUCTION },
        { role: 'user', content: verificationPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new VerificationError('Empty response from verification API');
    }

    const parsed = JSON.parse(
      sanitizeJsonContent(content),
    ) as Partial<PoemVerificationResult> | null;

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
