import type { DbReadinessSnapshot } from './db/readiness-manager';

type ReadinessFailureContext = 'bootstrap' | 'check' | 'middleware';
type ReadinessLogSnapshot = Pick<DbReadinessSnapshot, 'status' | 'lastError'>;

export function formatDbReadinessFailureLog(
  context: ReadinessFailureContext,
  snapshot: ReadinessLogSnapshot,
): string {
  const detailState = snapshot.lastError ? 'details redacted' : 'error unavailable';
  return `DB readiness ${context} failed (${snapshot.status}): ${detailState}`;
}
