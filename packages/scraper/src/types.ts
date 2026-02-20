export interface ScrapedPoem {
  sourceId: string; // Deterministic hash of source + url
  source: 'poets.org' | 'poetry-foundation' | 'loc-180' | 'gutenberg';
  sourceUrl: string;
  title: string;
  author: string;
  year: string | null;
  content: string; // Newline-separated stanzas, double-newline between stanzas
  themes: string[]; // Raw theme tags from source
  form: string | null;
  isPublicDomain: boolean;
  scrapedAt: string; // ISO 8601
}
