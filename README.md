# OdyssAI

An online narrative role-playing game where every player builds their own
universe, plays through it with an AI narrator that remembers everything, then
travels to someone else's. Every world ever created belongs to the same
multiverse and shares one common General Lore.

## The premise

The idea is not to wire a language model into a game loop and let it tell the
story. It is the opposite.

**The LLM narrates, the code decides.** No state is ever inferred from
generated text. A move, a wound, an item picked up, a relationship going sour:
each one is an explicit delta, validated by a Zod schema and then by the
engine's rules before anything is written. The narrator describes what just
happened, it does not decide what happened. That is what lets a campaign hold
together across dozens of sessions without drifting, and it is what separates
OdyssAI from a themed chatbot.

**Universes are sealed off from each other.** A universe never writes into
another one's state. When two players cross paths it goes through projections
and events, never through direct access. The General Lore is read-only for
everyone: it grows from what actually matters, without any single player
rewriting the shared history from their corner of the multiverse.

**Player text is untrusted input.** Including another player's character sheet
picked up along the way. Bounded schema, moderation, a delimited section in the
prompt: one world cannot be used to hijack another world's narrator.

**Identity does not live in the application.** Keycloak owns the account, the
password and the MFA. The API is the realm's only client, it is confidential,
and it acts as a broker: the browser holds nothing but an opaque session id,
and tokens never leave the server. The game profile (handle, universes,
progression) belongs to the application database and never travels back up into
the realm.

## Where the project stands

The marketing site (French and English) and Keycloak authentication work end to
end. The game engine, the narrator and the application database are not written
yet.

## Why this repository is public

So the work can be read. The source is here to be studied and reviewed, not to
be reused: OdyssAI is a personal project, and the code stays proprietary. See
`LICENSE`. The instructions below exist so that the code can be run and
understood by whoever is reading it, not as an invitation to operate a copy.

Pull requests are not expected. Anything merged from an outside contributor
would keep its author's copyright, which is exactly what this arrangement is
meant to avoid.

## Getting started

You need Node 24.11 (`.nvmrc`) and pnpm 11, which corepack provides.

```bash
corepack enable
pnpm install
```

**Two environment files, in two different places.** This is the first trap.
`apps/api` walks up the tree looking for a `.env`, so the one at the root
covers it. Next only ever reads its own application directory.

```bash
cp .env.example .env                    # origins, Keycloak, Redis
cp apps/web/.env.example apps/web/.env  # SITE_URL and the NEXT_PUBLIC_ flags
```

**Redis** is the session store. In development it runs on the server, reached
through an SSH tunnel from local port 16379 to remote 6379, which is why
`REDIS_URL` points at `localhost:16379`. A port accepting connections proves
nothing: the SSH client keeps the port bound even after the session behind it
has died. Check with a real `PING`, not with a port probe.

**Keycloak** is configured by a single idempotent script that goes exclusively
through the Admin REST API. That script is the source of truth for the realm's
configuration, not the web console.

```bash
KC_ADMIN_PASSWORD='...' ./infra/keycloak/setup-realm.sh odyssai-dev
```

It prints `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID` and
`KEYCLOAK_CLIENT_SECRET`, which go into the root `.env`.

Then:

```bash
pnpm dev
```

The site answers on http://localhost:3000, the API on http://localhost:3001.

## Commands

```bash
pnpm dev                                 # the whole monorepo, through turbo
pnpm build
pnpm lint
pnpm typecheck
pnpm --filter @odyssai/<pkg> <script>    # a single package
pnpm --filter @odyssai/<pkg> add <dep>   # never npm, never yarn
```

After touching `packages/schemas` outside of `pnpm dev`, rebuild it:
`pnpm --filter @odyssai/schemas build`.

## Two things that catch people out

`NEXT_PUBLIC_` variables are baked into the browser bundle at build time.
Supplying them at runtime does nothing: they go through a Dockerfile `ARG`,
which ties the image to its environment.

pnpm 11 refuses dependency install scripts by default. They are declared under
`allowBuilds`, at the root of `pnpm-workspace.yaml`. Do not run
`pnpm approve-builds`, which is interactive.
