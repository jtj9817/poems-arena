# @sanctuary/scraper

A specialized poetry scraping package for the Poem Arena project. Built with Bun and Cheerio.

## Features

- **Multi-Source Support:**
  - **Project Gutenberg:** Specialized parser for Ralph Waldo Emerson's public domain works.
  - **Library of Congress (Poetry 180):** Contemporary collection of 180 poems.
  - **Poets.org:** Large-scale, paginated corpus scraper.
- **Robust Parsing:** Specialized HTML-to-structured-text conversion that preserves stanzas and whitespace.
- **Polite Scraping:** Integrated rate limiting with concurrency control and minimum inter-request delays.
- **Data Integrity:** Deterministic `sourceId` generation for deduplication.
- **Type Safety:** Shared schema with the rest of the monorepo.

## Installation

```bash
pnpm install
```

## Usage

### Basic Scraping

Each source provides a dedicated scraper function.

```typescript
import { scrapePoetsOrg, scrapeGutenberg, scrapeLoc180 } from '@sanctuary/scraper';

// Scrape first 5 pages of Poets.org
const poetsOrgPoems = await scrapePoetsOrg(5);

// Scrape Emerson from Gutenberg
const gutenbergPoems = await scrapeGutenberg();

// Scrape a range of poems from LOC Poetry 180
const loc180Poems = await scrapeLoc180(1, 10);
```

### Rate Limiting

The scraper uses a custom `createRateLimiter` utility to ensure we don't overwhelm target servers.

- **Concurrency:** Limits the number of simultaneous requests.
- **Delay:** Ensures a minimum rest period between requests from the same worker.

Example configuration (internal to Poets.org scraper):

```typescript
const limit = createRateLimiter({ concurrency: 5, minDelay: 200 });
```

### Logging

The package includes a structured logger that supports `debug`, `info`, `warn`, and `error` levels. Set `SCRAPER_VERBOSE=true` in your environment to see detailed debug logs.

## Data Schema

All scrapers return an array of `ScrapedPoem` objects:

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

## Testing

### Unit and Regression Tests

The scraper uses Bun's built-in test runner.

```bash
# Run all scraper tests
pnpm test

# Run specific source tests
pnpm test src/scrapers/poets-org.test.ts
```

### E2E and Live Validation

End-to-end tests are located in the `packages/e2e` workspace and use Playwright to validate scraper behavior against live or mock endpoints.

```bash
# Run CDP-based live source validation
pnpm --filter @sanctuary/e2e test -- --project=cdp
```

## Development

### Adding a New Source

1. Define the source-specific scraping logic in `src/scrapers/<source-name>.ts`.
2. Utilize `src/parsers/poem-parser.ts` for consistent content extraction.
3. Use `src/utils/html.ts` for common DOM manipulation tasks.
4. Ensure the new scraper respects rate limits via `src/utils/rate-limiter.ts`.
5. Add regression tests in `src/scrapers/<source-name>.test.ts`.
