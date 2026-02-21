# ETL Input Contract

## Default Input Location

```
packages/scraper/data/raw/
```

Override with `--input-dir <path>`.

## Supported File Formats

- `*.json` — JSON array of `ScrapedPoem` objects.

## Record Schema (`ScrapedPoem`)

| Field            | Type                                                             | Required |
| ---------------- | ---------------------------------------------------------------- | -------- |
| `sourceId`       | `string` — deterministic hash of source + url                    | Yes      |
| `source`         | `'poets.org' \| 'poetry-foundation' \| 'loc-180' \| 'gutenberg'` | Yes      |
| `sourceUrl`      | `string` — full URL of the poem page                             | Yes      |
| `title`          | `string`                                                         | Yes      |
| `author`         | `string`                                                         | Yes      |
| `year`           | `string \| null`                                                 | No       |
| `content`        | `string` — `\n` between lines, `\n\n` between stanzas            | Yes      |
| `themes`         | `string[]` — raw theme tags from source                          | Yes      |
| `form`           | `string \| null` — e.g. "sonnet", "ode", "free-verse"            | No       |
| `isPublicDomain` | `boolean`                                                        | Yes      |
| `scrapedAt`      | `string` — ISO 8601 timestamp                                    | Yes      |

## Generating Raw Dumps

The scraper package provides `writeScrapedPoems()` in `packages/scraper/src/utils/writer.ts`:

```typescript
import { writeScrapedPoems } from '@sanctuary/scraper';

const filePath = await writeScrapedPoems(poems, 'packages/scraper/data/raw', 'gutenberg');
```

Output file naming: `{source}-{ISO-timestamp}.json`.

## Canonical Type Definition

The `ScrapedPoem` interface is defined in `packages/scraper/src/types.ts` and re-exported from `@sanctuary/scraper`.
