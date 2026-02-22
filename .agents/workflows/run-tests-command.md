---
description: Run tests with a 60s timeout
---

When executing test commands in this workspace, you must always enforce a 60-second timeout to prevent tests from hanging indefinitely.

Depending on the test runner being used, apply the appropriate timeout flag:

1. **Bun Test** (e.g., running `bun test` in `@sanctuary/etl` or `api`):
   Append `--timeout 60000` to the command.
   _Example:_ `bun test --timeout 60000`

2. **Playwright E2E Tests** (`@sanctuary/e2e`):
   Append `--timeout 60000` to the Playwright command.
   _Example:_ `pnpm --filter @sanctuary/e2e run test --timeout 60000`

3. **Vitest** (if used in the frontend React app):
   Append `--testTimeout=60000` or the `--timeout 60000` equivalent.

4. **Pest** (if interacting with any legacy PHP services as noted in memory):
   Ensure the underlying testing environment is constrained to 60 seconds if applicable.

**Rule:** Never run a raw `test` script or test runner command without explicitly setting this 60s timeout constraint.
