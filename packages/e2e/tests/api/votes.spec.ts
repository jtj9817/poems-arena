import { test, expect } from '@playwright/test';
import { apiGet, apiPost } from '../../lib/api-test-helpers';
import {
  assertVoteResponse,
  assertAnonymousDuel,
  type DuelListItemShape,
  type AnonymousDuelShape,
  type VoteResponseShape,
} from '../../lib/assert-schema';

test.describe('Votes API', () => {
  test('POST /votes with valid body returns { success, isHuman }', async () => {
    const { status: listStatus, body: listBody } =
      await apiGet<DuelListItemShape[]>('/duels?seed=42');

    expect(listStatus).toBe(200);
    expect(Array.isArray(listBody)).toBe(true);

    if (listBody.length === 0) {
      test.skip(true, 'No duels available for vote test');
      return;
    }

    const duelId = listBody[0].id;
    const { status: duelStatus, body: duelBody } = await apiGet<AnonymousDuelShape>(
      `/duels/${duelId}`,
    );

    expect(duelStatus).toBe(200);
    assertAnonymousDuel(duelBody);

    const { status, body } = await apiPost<VoteResponseShape>('/votes', {
      duelId,
      selectedPoemId: duelBody.poemA.id,
      readingTimeMs: 30_000,
    });

    expect(status).toBe(200);
    assertVoteResponse(body);
  });

  test('POST /votes with invalid duelId returns 404', async () => {
    const { status, body } = await apiPost<{ error: string }>('/votes', {
      duelId: 'nonexistent-duel-id',
      selectedPoemId: 'some-poem-id',
      readingTimeMs: 30_000,
    });

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });

  test('POST /votes with missing fields returns 400', async () => {
    const { status } = await apiPost<unknown>('/votes', {});

    expect(status).toBe(400);
  });
});
