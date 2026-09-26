# Settings live in an index

`packages/engine/src/tuning.ts` gathers what turns without changing logic: the credit scale, the tier bounds, the die, the inspiration and sheet bounds, the graph's attempts and replays, the GM's memory. Before it one had to know five files in three packages to know where a dial was.

- **A value has one definition.** The file is an index, not a copy: when the value belongs to a schema, it re-exports it from `@odyssai/schemas`, where the Zod schema enforcing it already reads it. Copying it would make two truths, and the false one would be the one one got used to reading.
- `GENERATION_ATTEMPTS_PER_NODE` and `GENERATION_REWRITES_MAX` live in `schemas/world.ts` and not in `narrator`, which the index cannot read: making `narrator` depend on `engine` for two integers cost more than moving them. A dial only seen in the file using it never gets turned.
- `recentTurns` and `recalledMax` left `turn-memory.service.ts` for the same reason, and because the first decides what a turn costs.
- What is **not there**: the tiers, allowances and prices included, which live in the database and get edited in the dashboard; the model choices and their caps, which stay in the environment; the lexical moderation list, which is not a dial but a decision per word.
