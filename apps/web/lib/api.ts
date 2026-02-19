import type { Duel } from '@sanctuary/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export interface DuelListItem {
  id: string;
  topic: string;
  humanWinRate: number;
  avgReadingTime: string;
  createdAt: string;
}

export interface AnonymousDuel {
  id: string;
  topic: string;
  poemA: { id: string; title: string; content: string };
  poemB: { id: string; title: string; content: string };
}

export interface DuelStats {
  humanWinRate: number;
  avgReadingTime: string;
  duel: Duel;
}

export interface VoteResponse {
  success: boolean;
  isHuman: boolean;
}

export const api = {
  getDuels(page = 1): Promise<DuelListItem[]> {
    return request(`/duels?page=${page}`);
  },

  getTodaysDuel(): Promise<AnonymousDuel> {
    return request('/duels/today');
  },

  getDuel(id: string): Promise<AnonymousDuel> {
    return request(`/duels/${id}`);
  },

  getDuelStats(id: string): Promise<DuelStats> {
    return request(`/duels/${id}/stats`);
  },

  vote(duelId: string, selectedPoemId: string): Promise<VoteResponse> {
    return request('/votes', {
      method: 'POST',
      body: JSON.stringify({ duelId, selectedPoemId }),
    });
  },
};
