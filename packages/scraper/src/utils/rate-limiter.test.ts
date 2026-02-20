import { expect, test, describe } from 'bun:test';
import { createRateLimiter } from './rate-limiter';

describe('createRateLimiter', () => {
  test('should execute tasks', async () => {
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });
    const result = await limiter(() => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  test('should respect concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    // Concurrency 1 ensures sequential execution
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 10 });

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
    };

    await Promise.all([limiter(task), limiter(task), limiter(task)]);

    expect(maxRunning).toBe(1);
  });

  test('should enforce minimum delay between tasks', async () => {
    const minDelay = 50;
    const limiter = createRateLimiter({ concurrency: 1, minDelay });

    const start = Date.now();
    await limiter(() => Promise.resolve());
    await limiter(() => Promise.resolve());
    const end = Date.now();

    // The total time should be at least minDelay (for the first task to finish + delay)
    // Actually if we just enforce delay *after* execution, then 2 tasks take:
    // Task 1 exec + delay + Task 2 exec + delay.
    // If tasks are instant, total time ~ 2 * delay.
    // Wait, usually the delay is between start times or end of one and start of next.
    // "Polite scraping" usually means waiting a bit after a request.

    expect(end - start).toBeGreaterThanOrEqual(minDelay);
  });

  // --- Regression tests (3B) ---

  test('concurrency=2 allows exactly 2 concurrent tasks', async () => {
    let running = 0;
    let maxRunning = 0;

    const limiter = createRateLimiter({ concurrency: 2, minDelay: 0 });

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running--;
    };

    await Promise.all([limiter(task), limiter(task), limiter(task), limiter(task)]);

    expect(maxRunning).toBe(2);
  });

  test('tasks beyond limit queue and execute when slot opens', async () => {
    const order: number[] = [];
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });

    const makeTask = (id: number) => async () => {
      order.push(id);
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    await Promise.all([limiter(makeTask(1)), limiter(makeTask(2)), limiter(makeTask(3))]);

    expect(order).toEqual([1, 2, 3]);
  });

  test('error in one task does not block subsequent tasks', async () => {
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });
    const results: string[] = [];

    const failingTask = () => Promise.reject(new Error('fail'));
    const successTask = async () => {
      results.push('success');
      return 'done';
    };

    const promises = [
      limiter(failingTask).catch(() => 'caught'),
      limiter(successTask),
      limiter(successTask),
    ];

    await Promise.all(promises);

    expect(results).toEqual(['success', 'success']);
  });
});
