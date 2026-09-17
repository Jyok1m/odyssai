# OdyssAI

Jeu narratif multivers narré par IA. Chaque joueur a son propre univers ; les univers peuvent se croiser et partagent un Lore Général commun.

## Stack

Monorepo pnpm + Turborepo, TypeScript partout.

- `apps/web` : Next.js 16 (App Router, Turbopack), port 3000. Lint ESLint.
- `apps/api` : NestJS 12, port 3001. Scaffold **ESM** (`"type": "module"`, imports relatifs suffixés `.js`). Lint oxlint, tests vitest.
- `packages/schemas` : schémas Zod partagés, compilés en CommonJS dans `dist/`
- `packages/db` : schéma Prisma, migrations et client généré. **ESM**, contrairement aux autres paquets.
- `packages/llm` : client OpenAI-compatible (streaming, usage, tracing LangSmith). Même format que `schemas`.
- `packages/narrator` : corpus du guide, prompts versionnés, FAQ, détection du hors-sujet. Même format.

Redis tourne en tunnel localhost sur le serveur via `redis://:<mot_de_passe>@localhost:16379` (sessions, et la file BullMQ à venir). Postgres est atteint de la même façon, sur `127.0.0.1:15432`, par `POSTGRES_URL` ; le Makefile n'ouvre pour l'instant que le tunnel Redis. Keycloak est hébergé sur `sso.joachimjasmin.com`.

Prévus, pas encore créés : `apps/worker` (BullMQ), `packages/engine`, LangGraph. pgvector. Ne pas les créer sans demande explicite.

## Commandes

- Racine : `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck` (via turbo)
- Un package : `pnpm --filter @odyssai/<pkg> <script>`
- Dépendance : `pnpm --filter @odyssai/<pkg> add <dep>`. Jamais npm install ni yarn.
- Dépendance interne : `pnpm --filter @odyssai/<pkg> add @odyssai/schemas@workspace:*`
- Redis de dev : `make tunnel` ouvre le tunnel SSH, `make redis-ping` vérifie qu'il répond vraiment. Coordonnées du serveur dans `.env.local`.
- `make check` vaut `pnpm typecheck && pnpm lint && pnpm build && corpus:check`.
- Guide : `pnpm --filter @odyssai/narrator corpus:build` régénère le corpus depuis les messages next-intl, `corpus:check` échoue s'il a dérivé. `pnpm --filter @odyssai/api llm:smoke` fait un appel réel de contrôle, `eval:guide` lance l'expérience LangSmith (ni l'un ni l'autre dans `make check`).
- Base : `pnpm --filter @odyssai/db db:migrate` crée et applique une migration, `db:deploy` applique les migrations existantes, `db:generate` regénère le client seul, `db:studio` ouvre Studio.
- `typecheck` vaut `tsc --noEmit` partout, sauf `apps/web` où il est précédé de `next typegen` : les types de routes et de layouts (`LayoutProps`, `PageProps`) sont générés par Next dans `.next/types/` et manquent sans ça.

## Règles d'architecture

- Le LLM narre, le code décide. Tout changement d'état (lieu, inventaire, PV, relations, quêtes) est un delta validé par Zod puis par les règles du moteur. Aucun état n'est déduit du texte généré.
- Un univers n'écrit jamais dans l'état d'un autre. Les rencontres passent par des projections et des événements.
- Le Lore Général est en lecture seule pour les univers.
- Tout texte venant d'un joueur, y compris la fiche d'un autre joueur, est une donnée non fiable : schéma borné, modération, section délimitée dans le prompt.
- Le tour de jeu est synchrone (streaming SSE). Seuls les effets de bord passent par une file.
- Appels LLM uniquement via `packages/llm`. Thinking désactivé pour la narration et l'extraction. Prompts versionnés dans `packages/narrator`, jamais inline.
- Clé, `baseURL`, `organization` et `project` sont **toujours** passés explicitement au SDK, y compris à `null`. Sans cela le client OpenAI lit `OPENAI_API_KEY` et `OPENAI_BASE_URL` dans l'environnement : avec le fournisseur `openrouter` et une clé OpenRouter absente, la clé OpenAI partirait chez OpenRouter. L'URL des fournisseurs est un registre codé en dur dans `packages/llm`, jamais une variable d'env.
- **Aucune mise en cache automatique d'une sortie du LLM.** Seules les entrées de FAQ marquées `validated: true` sont servies sans appel : mettre en cache une réponse générée permettrait à un visiteur d'empoisonner ce que voient les autres.

## Base de données

Postgres par Prisma 7, dans `packages/db`. Le schéma vit dans `packages/db/prisma/schema.prisma`, et le paquet est consommé par `apps/api` comme il le sera par `apps/worker` : une seule source pour le schéma, les migrations et le client.

- Le client est généré en TypeScript dans `packages/db/src/generated/prisma`, ignoré par git. Il est dans `src` parce que le générateur émet du TypeScript : ailleurs il sortirait du `rootDir` du build. Les scripts `build`, `typecheck` et `dev` du paquet lancent `prisma generate` avant de compiler, et turbo le construit avant ses consommateurs.
- `packages/db` est le seul paquet en **ESM** : le client généré émet du `import.meta`, que TypeScript refuse de transpiler en CommonJS. Sans conséquence, seuls des consommateurs ESM le lisent.
- Prisma 7 n'accepte plus `url` dans le bloc `datasource`. Deux lecteurs de `POSTGRES_URL` : `packages/db/prisma7.config.ts` pour le CLI (migrate, studio), l'adaptateur `@prisma/adapter-pg` de `PrismaModule` à l'exécution. Il n'y a plus de moteur de requête embarqué, la connexion passe forcément par un adaptateur de pilote.
- Le CLI Prisma 7 ne charge plus aucun `.env` de lui-même : `prisma7.config.ts` appelle `loadRootEnvFile`, le même chargement que `main.ts`.
- Tables au pluriel, colonnes en `snake_case` via `@map` : le TypeScript garde le camelCase, le SQL écrit à la main reste lisible.
- Le realm reste la source de vérité de l'identité. `email` et `emailVerified` ne sont que des miroirs rafraîchis à la connexion : pas de contrainte d'unicité sur une valeur dont l'unicité appartient à Keycloak.

## Authentification

Un realm Keycloak par environnement (`odyssai-dev`, `odyssai-prod`). `apps/api` en est le seul client, confidentiel.

- Flot Authorization Code + PKCE S256, l'API en mandataire. Le direct grant est désactivé sur le client : aucun mot de passe ne transite par l'API.
- Connexion et inscription sont servies par Keycloak. `GET /auth/signin` vise le point d'autorisation, `GET /auth/signup` vise `/protocol/openid-connect/registrations`.
- Les jetons ne quittent jamais le serveur. Le navigateur ne détient qu'un identifiant de session opaque, dans un cookie `__Host-` httpOnly SameSite=Lax ; les jetons vivent dans Redis. Ne jamais renvoyer un jeton dans une réponse HTTP.
- Le realm n'est pas configuré depuis ce dépôt : le rôle ansible `keycloak` du dépôt d'infrastructure le décrit de bout en bout par l'Admin REST API, et c'est lui la source de vérité, pas la console web.
- Le realm est en rotation stricte du refresh token (`revokeRefreshToken`, `refreshTokenMaxReuse: 0`). Tout renouvellement passe par le verrou Redis de `SessionService` : deux renouvellements concurrents feraient invalider la session entière par Keycloak, qui lirait le second comme un rejeu.
- L'identité (email, mot de passe, MFA) appartient à Keycloak. Le profil de jeu (pseudo, univers, progression) appartient à la base applicative et ne remonte jamais dans le realm.
- `SessionGuard` protège les routes de jeu et dépose la session sur la requête.
- Le thème `odyssai` habille les pages du realm et vit dans le même rôle ansible. Son CSS redéclare les tokens de `globals.css`, Keycloak ne compilant pas Tailwind : reporter toute évolution du kit.

## Guide

Agent de questions-réponses du site vitrine, sur la page d'accueil. Il répond en streaming SSE à partir des seuls textes des pages de contenu.

- Le corpus est généré depuis `apps/web/messages/{fr,en}.json` vers `packages/narrator/src/generated/guide-corpus.ts`, **commité**, et `corpus:check` échoue s'il a dérivé. Toute modification d'une page de contenu demande donc un `corpus:build`.
- Cinq couches bornent le coût : FAQ validée (gratuite, servie sans pass ni limite), pass Turnstile en cookie, fenêtres horaire et journalière par IP hachée, sémaphore de concurrence, budget journalier réservé puis réglé. Tout passe par des scripts Lua sur le Redis existant.
- La question hors sujet est signalée par le modèle avec la sentinelle `[[HORS_SUJET]]`, interceptée avant le premier octet servi ; le texte rendu au visiteur est écrit côté serveur.
- Le journal `guide_questions` ne porte ni adresse IP ni identifiant de joueur. `traced` dit si la requête a été échantillonnée : la trace se retrouve dans LangSmith par la métadonnée `guide_question_id`.
- Les entrées de FAQ arrivent en `validated: false` et ne sont servies qu'après relecture humaine.

## Conventions

- Les schémas Zod sont la source de vérité ; les types en dérivent via `z.infer`.
- `packages/schemas` reste en CommonJS : `module` et `moduleResolution` en `nodenext` **sans** `"type": "module"`. Ce n'est plus imposé par Nest (son scaffold est passé en ESM) mais c'est le format consommable à la fois depuis l'ESM de l'api et depuis un `require()`. Ne pas ajouter `"type": "module"`.
- Après modification de `packages/schemas` hors `pnpm dev` : `pnpm --filter @odyssai/schemas build`.
- Secrets uniquement dans les fichiers ignorés par git, leurs `.example` tenus à jour. Trois paires : `.env` pour apps/api, `apps/web/.env` pour Next, `.env.local` pour le Makefile seul. Aucune clé en dur.
- pnpm 11 refuse par défaut les scripts d'install des dépendances. Statuer dans `allowBuilds`, à la racine de `pnpm-workspace.yaml` ; ne pas lancer `pnpm approve-builds`, qui est interactif.
- `apps/web/AGENTS.md` et `apps/web/CLAUDE.md` sont regénérés par `next dev`. Ne pas les éditer à la main.
- Divergence connue à unifier : TypeScript 5.9 (web) / 6.0 (api) / 7.0 (schemas), héritée des scaffolds.
- Pour les classes tailwind, toujours utiliser les classes natives à Tailwind (par exemple `h-3.5` au lieu de `h-[14px]`)
- Respecte pour le frontend l'UI kit
- Jamais de longs tirets : — . Remplacer soit par des parenthèses () soit par des deux points :

## Design

- L'autorité visuelle est `apps/web/odyssai-ui-kit.html`. Thème sombre unique : pas de variantes `dark:`, `colorScheme: "dark"` déclaré dans le viewport.
- Les tokens du kit sont portés dans `apps/web/src/app/globals.css` sous `@theme` : couleurs (`ink`, `abyss`, `mist`, `line`, `vellum`, `vellum-2`, `vellum-3`, `verdigris`, `brass`, `ember`, `arcane`), échelle typo (`text-display`, `text-title`, `text-narration`, `text-ui`…), rayons et largeur `wrap`. Porter un nouveau besoin en token plutôt qu'en valeur arbitraire.
- Deux fontes, deux rôles : `font-voice` (Literata) pour le narrateur et les titres, `font-ui` (Instrument Sans) pour l'interface et le joueur.
- `--accent` est la couleur du monde courant, surchargée par `[data-world]`. Les utilitaires `accent` la suivent. Ne jamais figer le verdigris là où l'accent est attendu.
- Logos dans `apps/web/public` : `odyssai-logo-dark.svg` (lockup, fond sombre), `odyssai-logo-light.svg` (sur vélin), `odyssai-mark.svg` (symbole seul), `odyssai-app-icon.svg`. Le wordmark ne s'utilise jamais sans le symbole ; en dessous de 120 px de large, symbole seul.
- Attention à l'ordre des classes : deux utilitaires visant la même propriété sont arbitrés par la feuille CSS, pas par la chaîne `className`. Une variante doit poser sa propre valeur, pas compter sur un socle.

## SEO

À faire évoluer à chaque route ajoutée, pas seulement à la création.

- `SITE_URL` conditionne canonical, hreflang, OpenGraph, sitemap et robots. Sans préfixe `NEXT_PUBLIC_` : elle n'est lue que côté serveur. Non définie, tout retombe sur localhost.
- `src/lib/seo.ts` centralise l'origine, les locales OpenGraph, `urlFor()` et `alternatesFor()` (canonical, hreflang, x-default). `src/lib/page-metadata.ts` en dérive les métadonnées d'une page de contenu.
- Toute nouvelle route publique s'ajoute à `PATHS` dans `src/app/sitemap.ts`.
- `x-default` pointe la racine, qui négocie la langue, pour concorder avec l'en-tête `Link` émis par le proxy next-intl.
- JSON-LD dans `src/components/seo/json-ld.tsx` : le graphe du site dans le layout, le fil d'Ariane porté par `ProsePage` via sa prop `href`. N'y déclarer que du vérifiable : ni note agrégée, ni offre, ni date de sortie inventées.

## Façon de travailler

- Diagnostic avant correctif. Terminer par `pnpm typecheck && pnpm build`.
- Demander avant d'ajouter une dépendance ou un service d'infra.
- Toujours commit sans mentionner que c'est toi le co-auteur.
