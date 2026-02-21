import { describe, expect, test } from 'bun:test';
import { createDb } from './client';

describe('createDb', () => {
  test('returns a drizzle db instance with select capability', () => {
    const db = createDb({ url: 'file::memory:' });
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });

  test('returns a drizzle db instance with insert capability', () => {
    const db = createDb({ url: 'file::memory:' });
    expect(typeof db.insert).toBe('function');
  });

  test('returns a drizzle db instance with update capability', () => {
    const db = createDb({ url: 'file::memory:' });
    expect(typeof db.update).toBe('function');
  });

  test('returns a drizzle db instance with delete capability', () => {
    const db = createDb({ url: 'file::memory:' });
    expect(typeof db.delete).toBe('function');
  });

  test('creates independent instances for different configs', () => {
    const db1 = createDb({ url: 'file::memory:' });
    const db2 = createDb({ url: 'file::memory:' });
    expect(db1).not.toBe(db2);
  });
});
