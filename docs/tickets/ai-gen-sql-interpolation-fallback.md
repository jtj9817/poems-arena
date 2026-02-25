# [BUG] SQL Injection / Data Safety Risk via Manual Interpolation Fallback in Persistence Layer

## Summary

The `PersistenceDb` interface and its implementation in `index.ts` use rest parameters (`...args`), which causes `executeFn.length >= 2` to erroneously evaluate to `false`. This silently bypasses the database client's native parameterized query binding and falls back to a custom, less secure string interpolation method `escapeSqlValue`.

## Component

`@sanctuary/ai-gen` - Database Persistence

## Description

In `packages/ai-gen/src/persistence.ts`, the database execution wrapper uses the length of the provided `execute` function to determine whether to pass parameters directly to the native database client or to manually interpolate strings:

```typescript
const executeFn = db.execute as (
  ...args: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

if (executeFn.length >= 2) {
  return executeFn(query, params);
}
// Falls back to manual interpolation using regex matching and escapeSqlValue()
```

However, the implementation of `PersistenceDb.execute` in `packages/ai-gen/src/index.ts` is defined with rest parameters:

```typescript
execute: async (...args: unknown[]) => {
  const [query, params] = args as [string, unknown[] | undefined];
  // ...
};
```

In JavaScript, a function using a rest parameter (`...args`) has a `length` of `0`. Therefore, the condition `executeFn.length >= 2` is never met, forcing all queries to use manual string interpolation. This poses a severe data safety and SQL injection risk by bypassing native prepared statements.

## Proposed Solution

Refactor the `PersistenceDb` interface and implementation to strictly require `query` and `params` arguments rather than relying on rest parameters and brittle function length checks.

### Suggested Changes

1. **Update `PersistenceDb` Interface in `packages/ai-gen/src/persistence.ts`:**

```typescript
export interface PersistenceDb {
  execute(
    query: string,
    params?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}
```

2. **Remove the `executeFn.length` check and manual interpolation logic in `executeQuery`:**

```typescript
async function executeQuery(
  db: PersistenceDb,
  query: string,
  params: unknown[] = [],
): Promise<{ rows: Array<Record<string, unknown>> }> {
  return db.execute(query, params);
}
```

3. **Update the implementation in `packages/ai-gen/src/index.ts`:**

```typescript
const persistenceDb: PersistenceDb = {
  execute: async (query: string, params?: unknown[]) => {
    const result = await rawClient.execute({
      sql: query,
      args: params ?? [],
    });
    return { rows: result.rows ?? [] };
  },
};
```
