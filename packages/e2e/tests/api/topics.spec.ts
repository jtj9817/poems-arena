import { test, expect } from '@playwright/test';
import { apiGet } from '../../lib/api-test-helpers';
import { assertTopic, type TopicShape, type DuelListItemShape } from '../../lib/assert-schema';

test.describe('Topics API', () => {
  test('GET /topics returns 200 with an array', async () => {
    const { status, body } = await apiGet<TopicShape[]>('/topics');

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /topics returns topics with id and label fields', async () => {
    const { status, body } = await apiGet<TopicShape[]>('/topics');

    expect(status).toBe(200);
    if (body.length > 0) {
      assertTopic(body[0]);
    }
  });

  test('GET /duels?topic_id filters by topic and returns 200', async () => {
    // Fetch available topics first
    const { body: topics } = await apiGet<TopicShape[]>('/topics');

    const topicWithId = topics.find((t) => t.id !== null);
    if (!topicWithId || topicWithId.id === null) {
      test.skip(true, 'No topics with a valid ID available for filter test');
      return;
    }

    const { status, body } = await apiGet<DuelListItemShape[]>(`/duels?topic_id=${topicWithId.id}`);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /duels with unknown topic_id returns empty array', async () => {
    const { status, body } = await apiGet<DuelListItemShape[]>(
      '/duels?topic_id=nonexistent-topic-id-99999',
    );

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});
