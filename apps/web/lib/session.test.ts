import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionSeed } from './session';

function createSessionStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('getSessionSeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the stored session seed when present', () => {
    const sessionStorage = createSessionStorageMock();
    sessionStorage.setItem('duel-seed', '12345');
    vi.stubGlobal('sessionStorage', sessionStorage);

    expect(getSessionSeed()).toBe(12345);
    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('creates and stores a seed when none is present', () => {
    const sessionStorage = createSessionStorageMock();
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const seed = getSessionSeed();

    expect(seed).toBe(1_073_741_823);
    expect(sessionStorage.setItem).toHaveBeenCalledWith('duel-seed', '1073741823');
  });

  it('replaces an invalid stored seed', () => {
    const sessionStorage = createSessionStorageMock();
    sessionStorage.setItem('duel-seed', 'not-a-number');
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);

    const seed = getSessionSeed();

    expect(seed).toBe(536_870_911);
    expect(sessionStorage.setItem).toHaveBeenCalledWith('duel-seed', '536870911');
  });
});
