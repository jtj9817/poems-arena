import { GoogleGenAI } from '@google/genai';

export interface ThinkingConfig {
  thinkingBudget?: number;
}

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  systemInstructions: string;
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  maxOutputTokens?: number;
}

export interface PoemOutput {
  title: string;
  content: string;
}

export class PoemGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'PoemGenerationError';
  }
}

const DEFAULT_MODEL = 'gemini-2.0-flash-preview';
const DEFAULT_TEMPERATURE = 1.0;

const POEM_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['title', 'content'],
};

export interface GeneratePoemParams {
  prompt: string;
  config: GeminiConfig;
}

export async function generatePoem(params: GeneratePoemParams): Promise<PoemOutput> {
  const { prompt, config } = params;
  const model = config.model ?? DEFAULT_MODEL;
  const temperature = config.temperature ?? DEFAULT_TEMPERATURE;

  try {
    const client = new GoogleGenAI({ apiKey: config.apiKey });

    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseSchema: POEM_RESPONSE_SCHEMA,
      temperature,
      systemInstruction: config.systemInstructions,
    };

    if (config.maxOutputTokens) {
      generationConfig.maxOutputTokens = config.maxOutputTokens;
    }

    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig;
    }

    const result = await client.models.generateContent({
      model,
      contents: prompt,
      config: generationConfig,
    });

    const responseText = result.text;

    if (!responseText) {
      throw new PoemGenerationError('Empty response from Gemini API');
    }

    const parsed = JSON.parse(responseText) as PoemOutput;

    if (!parsed.title || !parsed.content) {
      throw new PoemGenerationError('Invalid response format: missing title or content');
    }

    return parsed;
  } catch (error) {
    if (error instanceof PoemGenerationError) {
      throw error;
    }
    throw new PoemGenerationError(
      `Failed to generate poem: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }
}
