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

export interface Duel {
  id: string;
  topic: string;
  topicId?: string;
  poemA: Poem;
  poemB: Poem;
  humanWinRate: number; // Percentage 0-100
  avgReadingTime: string; // e.g., "4m 12s"
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
