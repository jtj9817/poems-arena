import { test, expect } from '@playwright/test';
import { apiGet } from '../../lib/api-test-helpers';
import {
  assertDuelListItem,
  assertAnonymousDuel,
  assertDuelStats,
  type AnonymousDuelShape,
  type DuelListItemShape,
  type DuelStatsShape,
} from '../../lib/assert-schema';

test.describe('Duels API', () => {
  test('GET /duels returns array with correct shape', async () => {
    const { status, body } = await apiGet<DuelListItemShape[]>('/duels');

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);

    if (body.length > 0) {
      assertDuelListItem(body[0]);
    }
  });

  test('GET /duels?page=1 returns first page', async () => {
    const { status, body } = await apiGet<DuelListItemShape[]>('/duels?page=1');

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /duels/today returns anonymous duel (no author/type on poems)', async () => {
    const { status, body } = await apiGet<AnonymousDuelShape | { error: string }>('/duels/today');

    // Could be 404 if no duels seeded
    if (status === 404) {
      expect(body).toHaveProperty('error');
      return;
    }

    expect(status).toBe(200);
    assertAnonymousDuel(body);
  });

  test('GET /duels/:id with invalid ID returns 404', async () => {
    const { status, body } = await apiGet<{ error: string }>('/duels/nonexistent-id-12345');

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });

  test('GET /duels/:id/stats returns full reveal with author and type', async () => {
    // First get a valid duel
    const { body: todayBody, status: todayStatus } = await apiGet<
      AnonymousDuelShape | { error: string }
    >('/duels/today');

    if (todayStatus === 404) {
      test.skip(true, 'No duels available for stats test');
      return;
    }

    const duel = todayBody as AnonymousDuelShape;
    const { status, body } = await apiGet<DuelStatsShape>(`/duels/${duel.id}/stats`);

    expect(status).toBe(200);
    assertDuelStats(body);
  });

  test('GET /duels/:id/stats with invalid ID returns 404', async () => {
    const { status, body } = await apiGet<{ error: string }>('/duels/nonexistent-id-12345/stats');

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });
});
