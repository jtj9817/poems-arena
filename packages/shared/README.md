# @sanctuary/shared

Shared TypeScript types, constants, and utilities for the Poems Arena monorepo.

## Installation

```bash
pnpm install
```

## Core Types

### ScrapedPoem

The basic data model for poems acquired from external sources. Used primarily by `packages/scraper` and the data pipeline.

```typescript
interface ScrapedPoem {
  sourceId: string; // Deterministic hash of source + url + title
  source: 'poets.org' | 'loc-180' | 'gutenberg';
  sourceUrl: string;
  title: string;
  author: string;
  year: string | null;
  content: string; // Newline-separated stanzas, double-newline between stanzas
  themes: string[]; // Raw theme tags from source
  form: string | null;
  isPublicDomain: boolean;
  scrapedAt: string; // ISO 8601 timestamp
}
```

### Poem

The core entity used in the application for duels and display.

```typescript
export enum AuthorType {
  HUMAN = 'HUMAN',
  AI = 'AI',
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
  prompt?: string; // Used for AI-generated poems
  parentPoemId?: string; // Reference to a human poem for imitation duels
}
```

### Duel and Result

Types for the side-by-side comparison feature.

```typescript
export interface Duel {
  id: string;
  topic: string;
  topicId?: string;
  poemA: Poem;
  poemB: Poem;
  humanWinRate: number; // Community-wide percentage 0-100
  avgReadingTime: string; // Formatted time string e.g., "4m 12s"
}

export interface DuelResult {
  duelId: string;
  selectedPoemId: string;
  isHuman: boolean;
}
```

## State and Navigation

### ViewState

Enums for managing frontend routing and application state.

```typescript
export enum ViewState {
  FOYER = 'FOYER', // Landing page / Featured duel
  READING_ROOM = 'READING_ROOM', // Active voting interface
  ANTHOLOGY = 'ANTHOLOGY', // Past duels archive
  COLOPHON = 'COLOPHON', // Philosophy and methodology
}
```
