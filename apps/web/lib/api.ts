import type {
  AnonymousDuel,
  DuelListItem,
  DuelStatsResponse,
  TopicMeta,
  VoteRequest,
  VoteResponse,
} from '@sanctuary/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

type ApiErrorPayload = {
  error?: string;
  code?: string;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const rawBody = await res.text();

    let message = `API error ${res.status}`;
    let code: string | undefined;

    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as ApiErrorPayload;
        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
          message = parsed.error;
        } else {
          message = `${message}: ${rawBody}`;
        }
        if (typeof parsed.code === 'string') {
          code = parsed.code;
        }
      } catch {
        message = `${message}: ${rawBody}`;
      }
    }

    throw new ApiRequestError(message, res.status, code, rawBody);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTopics(): Promise<TopicMeta[]> {
    return request('/topics');
  },

  getDuels(page = 1, topicId?: string, seed?: number, sort?: 'recent'): Promise<DuelListItem[]> {
    const params = new URLSearchParams({ page: String(page) });
    if (topicId !== undefined) params.set('topic_id', topicId);
    if (seed !== undefined) params.set('seed', String(seed));
    if (sort !== undefined) params.set('sort', sort);
    return request(`/duels?${params}`);
  },

  getDuel(id: string): Promise<AnonymousDuel> {
    return request(`/duels/${id}`);
  },

  getDuelStats(id: string): Promise<DuelStatsResponse> {
    return request(`/duels/${id}/stats`);
  },

  vote(payload: VoteRequest): Promise<VoteResponse> {
    return request('/votes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
