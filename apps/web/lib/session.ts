const SEED_KEY = 'duel-seed';
const MAX_SESSION_SEED = 2_147_483_647;

let inMemorySeed: number | null = null;

export function getSessionSeed(): number {
  if (inMemorySeed !== null) {
    return inMemorySeed;
  }

  let stored: string | null;
  try {
    stored = sessionStorage.getItem(SEED_KEY);
  } catch {
    const seed = Math.floor(Math.random() * MAX_SESSION_SEED);
    inMemorySeed = seed;
    return seed;
  }
  const parsed = stored === null ? Number.NaN : Number.parseInt(stored, 10);

  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_SESSION_SEED) {
    return parsed;
  }

  const seed = Math.floor(Math.random() * MAX_SESSION_SEED);
  try {
    sessionStorage.setItem(SEED_KEY, String(seed));
  } catch {
    // Some environments block Web Storage (SecurityError/QuotaExceededError). Keep a stable seed in-memory.
    inMemorySeed = seed;
  }
  return seed;
}
