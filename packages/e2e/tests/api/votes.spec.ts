import { test, expect } from '@playwright/test';
import { apiGet, apiPost } from '../../lib/api-test-helpers';
import {
  assertVoteResponse,
  type AnonymousDuelShape,
  type VoteResponseShape,
} from '../../lib/assert-schema';

test.describe('Votes API', () => {
  test('POST /votes with valid body returns { success, isHuman }', async () => {
    // First get a valid duel
    const { body: duel, status: duelStatus } = await apiGet<AnonymousDuelShape | { error: string }>(
      '/duels/today',
    );

    if (duelStatus === 404) {
      test.skip(true, 'No duels available for vote test');
      return;
    }

    const anonDuel = duel as AnonymousDuelShape;
    const { status, body } = await apiPost<VoteResponseShape>('/votes', {
      duelId: anonDuel.id,
      selectedPoemId: anonDuel.poemA.id,
    });

    expect(status).toBe(200);
    assertVoteResponse(body);
  });

  test('POST /votes with invalid duelId returns 404', async () => {
    const { status, body } = await apiPost<{ error: string }>('/votes', {
      duelId: 'nonexistent-duel-id',
      selectedPoemId: 'some-poem-id',
    });

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });

  test('POST /votes with missing fields returns 400', async () => {
    const { status } = await apiPost<unknown>('/votes', {});

    expect(status).toBe(400);
  });
});
