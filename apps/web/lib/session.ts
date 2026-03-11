const SEED_KEY = 'duel-seed';
const MAX_SESSION_SEED = 2_147_483_647;

export function getSessionSeed(): number {
  const stored = sessionStorage.getItem(SEED_KEY);
  const parsed = stored === null ? Number.NaN : Number.parseInt(stored, 10);

  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_SESSION_SEED) {
    return parsed;
  }

  const seed = Math.floor(Math.random() * MAX_SESSION_SEED);
  sessionStorage.setItem(SEED_KEY, String(seed));
  return seed;
}
