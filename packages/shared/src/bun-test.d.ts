declare module 'bun:test' {
  export interface BunExpectMatchers {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toHaveLength(expected: number): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): BunExpectMatchers;
}
