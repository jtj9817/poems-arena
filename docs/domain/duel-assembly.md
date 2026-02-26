# Domain Model: Duel Assembly

## Overview

Duel Assembly is the process by which HUMAN and AI poems are paired together to form "duels" for users to evaluate in the Reading Room. This process is handled by the `@sanctuary/ai-gen` package.

## Core Rules & Policies

### 1. Many-Duels-Per-Poem
To maximize data gathering and allow for repeated "Turing test" style evaluations, a single HUMAN poem can be matched with multiple different AI poems, provided they share the same topic. The system does not enforce a strict 1:1 monogamous relationship between a human poem and an AI poem.

### 2. Unordered Pair Uniqueness
While a poem can participate in multiple duels, a specific pair of poems (Poem X and Poem Y) can only ever form **one** unique duel.
- The order of the poems does not matter for identity. `(Poem A, Poem B)` is logically identical to `(Poem B, Poem A)`.
- This is enforced by generating a deterministic duel ID based on the sorted IDs of the two poems.

### 3. Topic Resolution
Duels must be grounded in a specific topic (e.g., "Nature", "Mortality").
- A duel is only formed if both the HUMAN and AI poem share at least one topic tag.
- If the two poems share multiple topics, the system deterministically selects one topic based on a seed derived from the poem IDs. This prevents a statistical skew where alphabetically earlier topics (e.g., "Childhood") are always selected over later ones.

### 4. Bounded Fan-Out
To prevent a combinatorial explosion of duels as the database grows, the system enforces a "max fan-out" limit (default: 10).
- A single HUMAN poem will only be paired with up to `maxFanOut` AI poems.
- The selection of which AI poems are chosen is deterministic (again, seeded by the poem pair) to ensure consistency while avoiding alphabetical bias.

### 5. Idempotency & Positional Bias
- **Idempotency:** The assembly script can be run multiple times safely. It uses `INSERT OR IGNORE` and checks for existing deterministic duel IDs to ensure duplicates are not created.
- **Positions:** When a duel is first created, the assignment of `poem_a` and `poem_b` is randomized (deterministically seeded) so the HUMAN poem is not predictably always on the left or right side.
