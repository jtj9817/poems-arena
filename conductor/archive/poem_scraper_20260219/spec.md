# Track Specification: Implement Poem Scraper Package and Source Parsers

## Overview

This track focuses on building the initial data acquisition layer for Poems Arena. It involves creating a dedicated `packages/scraper` package and implementing parsers for three key sources: Project Gutenberg (Emerson), LOC Poetry 180, and Poets.org.

## Objectives

- Scaffold a new `packages/scraper` package within the pnpm workspace.
- Implement a robust HTML-to-structured-poem extraction logic.
- Create source-specific scrapers for:
  - **Project Gutenberg:** Parse Ralph Waldo Emerson's poems from a single HTML file.
  - **LOC Poetry 180:** Scrape 180 contemporary poems from the Library of Congress.
  - **Poets.org:** Implement a paginated scraper for the primary poem corpus.
- Ensure all scraped data follows a consistent `ScrapedPoem` schema.
- Implement polite scraping practices (rate limiting, delays).

## Technical Requirements

- **Runtime:** Bun
- **Libraries:**
  - `cheerio`: For HTML parsing.
  - `p-limit`: For concurrency and rate limiting.
- **Data Schema:**
  ```typescript
  interface ScrapedPoem {
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
  ```

## Success Criteria

- `packages/scraper` is correctly integrated into the monorepo.
- Successful extraction of poems from all three target sources.
- Scraped data is saved as structured JSON/NDJSON in `packages/scraper/data/raw/`.
- Scraper respects rate limits and provides structured logging.
