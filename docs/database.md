# Database

Postgres through Prisma 7, in `packages/db`. The schema lives in `packages/db/prisma/schema.prisma`, and the package is consumed by `apps/api` as it will be by `apps/worker`: a single source for the schema, the migrations and the client.

- The client is generated in TypeScript into `packages/db/src/generated/prisma`, git-ignored. It is in `src` because the generator emits TypeScript: elsewhere it would fall outside the build's `rootDir`. The `build`, `typecheck` and `dev` scripts of the package run `prisma generate` before compiling, and turbo builds it before its consumers.
- `packages/db` is the only package in **ESM**: the generated client emits `import.meta`, which TypeScript refuses to transpile to CommonJS. No consequence: only ESM consumers read it.
- Prisma 7 no longer accepts `url` in the `datasource` block. Two readers of `POSTGRES_URL`: `packages/db/prisma7.config.ts` for the CLI (migrate, studio), the `@prisma/adapter-pg` adapter of `PrismaModule` at runtime. There is no more embedded query engine, the connection necessarily goes through a driver adapter.
- The Prisma 7 CLI no longer loads any `.env` by itself: `prisma7.config.ts` calls `loadRootEnvFile`, the same loading as `main.ts`.
- Migrate **before** switching the images, so the old code runs a few seconds on the new schema: a migration must stay readable by the version it replaces. A column is removed in two deployments, never in the one that stops writing it.
- The realm remains the source of truth for identity. `email` and `emailVerified` are only mirrors refreshed at login: no unique constraint on a value whose uniqueness belongs to Keycloak.

## The LangGraph checkpointer lives in its own schema

`PostgresSaver` is built with `schema: 'langgraph'`. In `public`, its tables were invisible to Prisma, and **every `migrate diff` proposed dropping them**, which would have erased the resume state of generations in progress. Do not bring them back there.

## `prisma generate` is a separate turbo task

`build` and `typecheck` of `packages/db` each called it on their side, and turbo runs them in parallel: the two `mkdir` of the same generated directory stepped on each other (`EEXIST`). It only showed with a cold cache. Generation is now a `generate` task that `build`, `typecheck` and `dev` depend on. **Do not put it back in the scripts.**
