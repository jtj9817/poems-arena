# [TECH-DEBT] Phase 5 Duel Assembly & API Scale Bottlenecks

**Issue Type:** Technical Debt / Performance
**Severity:** High
**Component:** Backend (`apps/api`), AI Generator (`packages/ai-gen`)

## Description

A comprehensive architectural review of the Phase 5 "Duel Assembly & API Updates" implementation revealed several algorithmic flaws and load-bearing bottlenecks. While functionally correct for small datasets, these mechanisms will fail or severely degrade as the platform scales to tens of thousands of poems and millions of votes.

## Findings & Impact

### 1. Sequential N+1 Inserts (Write Bottleneck)

- **Location:** `persistDuelCandidates` in `packages/ai-gen/src/duel-assembly.ts`
- **Issue:** The system iterates through the generated `candidates` array and `await`s a single `INSERT OR IGNORE` query for each candidate sequentially.
- **Impact:** Generating 5,000 new pairs results in 5,000 consecutive network round-trips to the LibSQL/Turso database. This sequential awaiting will drastically slow down the pipeline execution time.

### 2. Unbounded Memory Exhaustion (Read Bottleneck)

- **Location:** `fetchExistingDuelIds` and `fetchPoemsWithTopics` in `packages/ai-gen/src/duel-assembly.ts`
- **Issue:** To enforce idempotency, the script executes `SELECT id FROM duels` and loads _every single duel ID_ in the database into an in-memory `Set`. It similarly fetches _all_ poems and their topics into memory upfront.
- **Impact:** As the platform accumulates hundreds of thousands of duels, this will consume massive amounts of Node/Bun heap memory and significantly delay the start of the assembly script, eventually leading to OOM crashes.

### 3. Severe Exposure Skew in Fan-Out Logic (Algorithmic Flaw)

- **Location:** `assemblePairs` in `packages/ai-gen/src/duel-assembly.ts` (Lines 141-143)
- **Issue:** To prevent combinatorial explosion, the algorithm caps the pairings per Human poem using `maxFanOut` (default 10). It selects these by sorting the eligible AI poems lexicographically by their ID: `eligible.sort((a, b) => a.id.localeCompare(b.id)).slice(0, maxFanOut);`.
- **Impact:** Because it strictly slices the top $N$ by ID, the system heavily biases towards reusing the exact same "oldest/earliest" AI poems for every human poem in a given topic. Newer AI generated poems may _never_ be selected for a duel if the topic already has >= 10 older AI poems.

### 4. Expensive On-The-Fly Aggregation (API Read Penalty)

- **Location:** `GET /duels` in `apps/api/src/routes/duels.ts`
- **Issue:** The paginated archive endpoint uses a `LEFT JOIN` against the `votes` table with a `GROUP BY` to dynamically calculate `totalVotes` and `humanWinRate`, combined with `OFFSET` pagination.
- **Impact:** In SQL, `OFFSET N` requires computing and discarding the first $N$ rows. Combining this with on-the-fly aggregation across the `votes` table means that querying deep into the pagination will trigger increasingly expensive table scans and groupings, blocking the event loop or exhausting DB compute.

## Recommended Fixes

1. **Bulk Inserts:** Refactor `persistDuelCandidates` to use batched inserts (`INSERT INTO ... VALUES (...), (...), ...`) in chunks of ~500 rows, or utilize transaction blocks.
2. **Push Idempotency to DB:** Remove the in-memory `existingDuelIds` Set. Either rely entirely on the database's `UNIQUE` constraints via `INSERT OR IGNORE`, or compute candidate hashes first and query the DB with a `WHERE id IN (...)` clause.
3. **Deterministic Shuffling:** Use the existing `seedFromPoemIds` helper to pseudo-randomly shuffle or offset the AI candidate slice. This ensures fair exposure of AI poems while remaining deterministic across reruns.
4. **Materialized Views/Columns:** For `GET /duels`, introduce materialized columns (e.g., `total_votes`, `human_votes`) on the `duels` table that are updated asynchronously or via triggers, removing the need for on-the-fly `LEFT JOIN` aggregations.
