# Implementation Plan: Implement Poem Scraper Package and Source Parsers

This plan covers Phase 2 of the Data Pipeline, focusing on the initial scraper implementation.

## Phase 1: Scaffolding and Core Utilities

- [ ] Task: Scaffold `packages/scraper` package
  - [ ] Create directory structure and `package.json`
  - [ ] Configure `tsconfig.json`
  - [ ] Install dependencies (`cheerio`, `p-limit`, `@sanctuary/shared`)
- [ ] Task: Implement Core Scraper Utilities
  - [ ] Write tests for common HTML parser utility
  - [ ] Implement `parsers/poem-parser.ts` (HTML -> structured text)
  - [ ] Implement `utils/rate-limiter.ts`
  - [ ] Implement `utils/logger.ts`

## Phase 2: Source Implementations

- [ ] Task: Implement Project Gutenberg (Emerson) Parser
  - [ ] Write tests for Gutenberg parser
  - [ ] Implement `scrapers/gutenberg.ts`
  - [ ] Verify extraction of title, author, and content from sample HTML
- [ ] Task: Implement LOC Poetry 180 Scraper
  - [ ] Write tests for LOC scraper
  - [ ] Implement `scrapers/loc-180.ts`
  - [ ] Verify collection of 180 poems and metadata
- [ ] Task: Implement Poets.org Scraper
  - [ ] Write tests for Poets.org list and detail scrapers
  - [ ] Implement `scrapers/poets-org.ts` with pagination and checkpointing
  - [ ] Verify extraction of themes and public domain status
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Scraper' (Protocol in workflow.md)
