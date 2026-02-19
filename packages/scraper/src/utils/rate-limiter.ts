import pLimit from 'p-limit';

interface RateLimiterOptions {
  concurrency: number;
  minDelay: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const limit = pLimit(options.concurrency);
  const minDelay = options.minDelay;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return limit(async () => {
      const result = await fn();
      if (minDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, minDelay));
      }
      return result;
    });
  };
}
