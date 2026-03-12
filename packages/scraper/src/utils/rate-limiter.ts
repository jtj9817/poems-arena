interface RateLimiterOptions {
  concurrency: number;
  minDelay: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const concurrency = Math.max(1, options.concurrency);
  const minDelay = Math.max(0, options.minDelay);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (activeCount >= concurrency) {
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) {
      return;
    }

    nextTask();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const runTask = async () => {
        activeCount += 1;
        try {
          const result = await fn();
          if (minDelay > 0) {
            await sleep(minDelay);
          }
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          activeCount -= 1;
          runNext();
        }
      };

      queue.push(runTask);
      runNext();
    });
}
