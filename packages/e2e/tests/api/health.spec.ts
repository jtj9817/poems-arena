import { test, expect } from '@playwright/test';
import { apiRootGet } from '../../lib/api-test-helpers';

test.describe('Health endpoint', () => {
  test('GET /health returns { status: "ok" }', async () => {
    const { status, body } = await apiRootGet<{ status: string }>('/health');

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
  });
});
