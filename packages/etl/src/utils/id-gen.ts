/**
 * Deterministic ID generation for ETL pipeline idempotency.
 *
 * Both `generatePoemId` and `generateScrapeSourceId` produce stable, lowercase
 * hex IDs derived from a SHA-256 hash of their normalised inputs. Repeated ETL
 * runs over the same data will therefore produce identical IDs, making upserts
 * (INSERT OR REPLACE) safe and duplicate-free.
 */

/**
 * Normalises a string for hashing: lowercase, trim, collapse whitespace.
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Hash an arbitrary string and return the first 12 hex characters.
 * Uses Bun's built-in SHA-256 via `Bun.CryptoHasher`.
 */
function hashToId(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex').slice(0, 12);
}

/**
 * Generate a deterministic poem ID from title and author.
 *
 * The same (title, author) pair — regardless of casing or extraneous whitespace
 * — will always map to the same 12-char hex ID.
 */
export function generatePoemId(title: string, author: string): string {
  return hashToId(`poem:${normalize(title)}:${normalize(author)}`);
}

/**
 * Generate a deterministic scrape-source provenance ID.
 *
 * Uniquely identifies a particular (poemId, source, sourceUrl) triple so
 * provenance rows can be upserted cleanly.
 */
export function generateScrapeSourceId(poemId: string, source: string, sourceUrl: string): string {
  return hashToId(`scrape:${poemId}:${normalize(source)}:${normalize(sourceUrl)}`);
}
