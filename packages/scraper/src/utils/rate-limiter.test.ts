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
});
