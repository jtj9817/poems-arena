# Documentation

This directory contains all project documentation for Classicist's Sanctuary.

## Structure

| Directory                              | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| [`plans/`](./plans/)                   | Active implementation plans and feature specs |
| [`backend/`](./backend/)               | API design, route contracts, DB schema notes  |
| [`domain/`](./domain/)                 | Domain model, business rules, glossary        |
| [`frontend/`](./frontend/)             | Component design, page flows, UI decisions    |
| [`architecture/`](./architecture/)     | System architecture, infrastructure, ADRs     |
| [`tickets/`](./tickets/)               | Work items and tracked findings               |
| [`archived-plans/`](./archived-plans/) | Completed or superseded plans                 |

## Key Plans

| Plan                                                                   | Status                                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`plans/001-data-pipeline-plan.md`](./plans/001-data-pipeline-plan.md) | **COMPLETE** — All 6 phases done: Schema, Scraper, ETL, AI Generation, Duel Assembly & API, Frontend Integration. |

## Key Docs

| Document | Description |
| --- | --- |
| [`backend/api-reference.md`](./backend/api-reference.md) | Full API route reference including `/topics`, `/duels`, `/duels/:id`, and `/duels/:id/stats` |
| [`frontend/components.md`](./frontend/components.md) | Frontend component API and interaction patterns (Phase 6) |
| [`domain/duel-assembly.md`](./domain/duel-assembly.md) | Duel pairing logic and topic resolution rules |
