import { expect, test, describe } from 'bun:test';
import { createRateLimiter } from './rate-limiter';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('createRateLimiter', () => {
  test('should execute tasks', async () => {
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });
    const result = await limiter(() => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  test('should respect concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });
    const gates = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];

    const task = (index: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await gates[index].promise;
      running--;
    };

    const first = limiter(task(0));
    const second = limiter(task(1));
    const third = limiter(task(2));

    await Promise.resolve();
    expect(maxRunning).toBe(1);

    gates[0].resolve();
    await first;
    await Promise.resolve();

    gates[1].resolve();
    await second;

    gates[2].resolve();
    await third;
  });

  test('should enforce minimum delay between tasks', async () => {
    const minDelay = 50;
    const sleepCalls: number[] = [];
    const sleepGates: Array<ReturnType<typeof createDeferred<void>>> = [];
    const executionOrder: number[] = [];

    const limiter = createRateLimiter({
      concurrency: 1,
      minDelay,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        const gate = createDeferred<void>();
        sleepGates.push(gate);
        await gate.promise;
      },
    });

    const first = limiter(async () => {
      executionOrder.push(1);
    });
    const second = limiter(async () => {
      executionOrder.push(2);
    });

    await Promise.resolve();
    expect(executionOrder).toEqual([1]);
    expect(sleepCalls).toEqual([minDelay]);

    sleepGates[0]?.resolve();
    await first;
    await Promise.resolve();

    expect(executionOrder).toEqual([1, 2]);
    expect(sleepCalls).toEqual([minDelay, minDelay]);

    sleepGates[1]?.resolve();
    await second;
  });

  // --- Regression tests (3B) ---

  test('concurrency=2 allows exactly 2 concurrent tasks', async () => {
    let running = 0;
    let maxRunning = 0;
    const limiter = createRateLimiter({ concurrency: 2, minDelay: 0 });
    const gates = [
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
    ];

    const task = (index: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await gates[index].promise;
      running--;
    };

    const promises = [limiter(task(0)), limiter(task(1)), limiter(task(2)), limiter(task(3))];

    await Promise.resolve();
    expect(maxRunning).toBe(2);

    gates[0].resolve();
    gates[1].resolve();
    await Promise.resolve();
    expect(maxRunning).toBe(2);

    gates[2].resolve();
    gates[3].resolve();
    await Promise.all(promises);
  });

  test('tasks beyond limit queue and execute when slot opens', async () => {
    const order: number[] = [];
    const limiter = createRateLimiter({ concurrency: 1, minDelay: 0 });
    const gates = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];

    const makeTask = (id: number, index: number) => async () => {
      order.push(id);
      await gates[index].promise;
    };

    const first = limiter(makeTask(1, 0));
    const second = limiter(makeTask(2, 1));
    const third = limiter(makeTask(3, 2));

    await Promise.resolve();
    expect(order).toEqual([1]);

    gates[0].resolve();
    await first;
    await Promise.resolve();
    expect(order).toEqual([1, 2]);

    gates[1].resolve();
    await second;
    await Promise.resolve();
    expect(order).toEqual([1, 2, 3]);

    gates[2].resolve();
    await third;
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
