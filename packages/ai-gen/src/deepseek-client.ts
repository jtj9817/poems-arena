import type OpenAI from 'openai';

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
  systemInstructions: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface PoemOutput {
  title: string;
  content: string;
}

export class PoemGenerationError extends Error {
  constructor(
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = 'PoemGenerationError';
  }
}

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TEMPERATURE = 1.5;
const DEFAULT_MAX_TOKENS = 2048;

const clientsByApiKey = new Map<string, Promise<OpenAI>>();

export async function getDeepSeekClient(apiKey: string): Promise<OpenAI> {
  const cached = clientsByApiKey.get(apiKey);
  if (cached) {
    return cached;
  }

  const clientPromise = import('openai').then(({ default: OpenAIClient }) => {
    return new OpenAIClient({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey,
      timeout: 30000,
      maxRetries: 2,
    });
  });

  clientsByApiKey.set(apiKey, clientPromise);
  return clientPromise;
}

export function sanitizeJsonContent(content: string): string {
  const trimmed = content.trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export interface GeneratePoemParams {
  prompt: string;
  config: DeepSeekConfig;
}

export async function generatePoem(params: GeneratePoemParams): Promise<PoemOutput> {
  const { prompt, config } = params;
  const model = config.model ?? DEFAULT_MODEL;
  const temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = config.maxOutputTokens ?? DEFAULT_MAX_TOKENS;

  try {
    const client = await getDeepSeekClient(config.apiKey);

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: config.systemInstructions },
        { role: 'user', content: `${prompt}\nRespond in JSON format.` },
      ],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new PoemGenerationError('Empty response from DeepSeek API');
    }

    const parsed = JSON.parse(sanitizeJsonContent(content)) as Partial<PoemOutput> | null;

    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.content !== 'string') {
      throw new PoemGenerationError('Invalid response format: missing title or content');
    }

    return {
      title: parsed.title,
      content: parsed.content,
    };
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
