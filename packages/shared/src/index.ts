export enum AuthorType {
  HUMAN = 'HUMAN',
  AI = 'AI',
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

export function sanitizeExternalHttpUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Canonical topic reference returned by the API. id is null when the duel has no linked topic row. */
export interface TopicMeta {
  id: string | null;
  label: string;
}

/** Provenance record from a scrape_sources row. */
export interface SourceProvenance {
  source: string;
  sourceUrl: string;
  scrapedAt: string;
  isPublicDomain: boolean;
}

/** Full source attribution for a poem, matching the shape of the API's buildSourceInfo helper. */
export interface SourceInfo {
  primary: {
    source: string | null;
    sourceUrl: string | null;
  };
  provenances: SourceProvenance[];
}

export interface Poem {
  id: string;
  title: string; // The real title
  content: string;
  author: string; // "Emily Dickinson" or "Claude 3 Opus"
  type: AuthorType;
  year?: string;
  source?: string;
  sourceUrl?: string;
  form?: string;
  prompt?: string;
  parentPoemId?: string;
  sourceInfo?: SourceInfo;
}

export interface Topic {
  id: string;
  label: string;
}

export interface DuelListItem {
  id: string;
  topic: string;
  topicMeta: TopicMeta;
  createdAt: string;
  humanWinRate: number; // Percentage 0-100
  avgDecisionTimeMs: number | null;
  avgDecisionTime: string | null; // e.g., "4m 12s"
}

export interface AnonymousPoem {
  id: string;
  title: string;
  content: string;
}

export interface AnonymousDuel {
  id: string;
  topic: string;
  poemA: AnonymousPoem;
  poemB: AnonymousPoem;
}

export interface RevealedPoem {
  id: string;
  title: string;
  content: string;
  author: string;
  type: AuthorType;
  year?: string | null;
  sourceInfo?: SourceInfo;
}

export interface Duel {
  id: string;
  topic: string;
  topicMeta: TopicMeta;
  poemA: RevealedPoem;
  poemB: RevealedPoem;
}

export interface GlobalStats {
  totalVotes: number;
  humanWinRate: number; // Percentage 0-100
  avgDecisionTimeMs: number | null;
  avgDecisionTime: string | null;
}

export interface TopicStats {
  topicMeta: TopicMeta;
  totalVotes: number;
  humanWinRate: number; // Percentage 0-100
  avgDecisionTimeMs: number | null;
  avgDecisionTime: string | null;
}

export interface DuelStatsResponse {
  humanWinRate: number; // Percentage 0-100
  globalStats: GlobalStats;
  topicStats: TopicStats;
  duel: Duel;
}

export enum ViewState {
  HOME = 'HOME',
  THE_RING = 'THE_RING',
  PAST_BOUTS = 'PAST_BOUTS',
  ABOUT = 'ABOUT',
}

export interface DuelResult {
  duelId: string;
  selectedPoemId: string;
  isHuman: boolean;
}

export interface VoteRequest {
  duelId: string;
  selectedPoemId: string;
  readingTimeMs: number;
}

export interface VoteResponse {
  success: boolean;
  isHuman: boolean;
}
