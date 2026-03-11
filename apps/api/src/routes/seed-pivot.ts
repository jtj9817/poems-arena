/**
 * Builds a deterministic duel-shaped pivot ID from a numeric seed.
 *
 * The pivot is used to implement seeded rotation over the duel corpus:
 * duels with IDs >= pivotId come first (group 0), then duels with IDs < pivotId
 * (group 1). Within each group rows are ordered by `duels.id ASC`, producing a
 * stable, full-corpus traversal that shifts based on the seed value.
 *
 * The output format `duel-<12 hex chars>` matches the duel ID namespace so the
 * lexicographic comparison in the SQL CASE expression is meaningful.
 */
export const DUEL_ID_PREFIX = 'duel-';
export const DUEL_ID_HEX_LENGTH = 12;

export function buildSeedPivot(seed: number): string {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError('Seed must be a non-negative safe integer');
  }

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(String(seed));
  const hex = hasher.digest('hex').slice(0, DUEL_ID_HEX_LENGTH);
  return `${DUEL_ID_PREFIX}${hex}`;
}
