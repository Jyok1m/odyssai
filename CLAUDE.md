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

Redis tourne en tunnel localhost sur le serveur via `redis://:<mot_de_passe>@localhost:16379` (sessions et file BullMQ). Postgres est atteint de la même façon, sur `127.0.0.1:15432`, par `POSTGRES_URL` ; le Makefile n'ouvre pour l'instant que le tunnel Redis. Keycloak est hébergé sur `sso.joachimjasmin.com`.

Prévus, pas encore créés : `packages/engine`, pgvector. Ne pas les créer sans demande explicite.

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

## Parcours d'entrée en jeu

De la page d'accueil au monde généré. `GET/PUT /onboarding` derrière `SessionGuard`, une seule ressource pour tout le parcours, et la route interne `/play` (servie `/jouer` en français) côté web.

- **Deux schémas par étape** dans `packages/schemas/src/onboarding.ts` : un brouillon permissif enregistré au fil de la saisie, un strict qui conditionne le passage à l'étape suivante. Le parcours doit être reprenable, donc une saisie à moitié remplie doit pouvoir s'écrire en base.
- `advance: true` sur une saisie incomplète **enregistre quand même**, puis répond 422 `incomplete` : rien de ce que le joueur a tapé ne se perd parce qu'il a cliqué trop tôt.
- L'étape `username` n'existe pas dans l'énumération de la base : elle se déduit de la présence d'un pseudo, et le poser passe par `PATCH /me`, pas par cette ressource.
- La ligne `universes` naît au premier enregistrement, jamais à la lecture : `GET /onboarding` n'écrit rien.
- On écrit à son étape ou en deçà, jamais au delà. `generating` et `ready` ferment le parcours ; `failed` reste ouvert, c'est la seule sortie d'une génération qui n'a pas abouti.
- Les thèmes sont effacés à chaque modification de l'inspiration : ils en sont une fonction pure, et un thème périmé ferait générer un monde à partir d'une saisie que le joueur a changée.
- `characters.name` est nullable : la fiche s'écrit en plusieurs fois, la présence du nom est exigée par le schéma strict, pas par la table.
- `AuthModule` réexporte `UsersModule` parce que Nest construit `SessionGuard` dans le module qui l'applique. Un module de jeu n'a donc qu'à importer `AuthModule`.
- La route est gardée par `NEXT_PUBLIC_ALPHA_OPEN` : fermée, elle répond 404 au lieu d'annoncer une ouverture.

## Création de personnage

Étape 3 du parcours. `GET /onboarding/character` rend la conversation, `POST .../messages` diffuse un tour en SSE, `POST .../extract` propose une fiche.

- **Le modèle propose, le schéma tranche, le joueur corrige.** L'extraction n'écrit rien : elle rend une proposition, et c'est `PUT /onboarding` qui enregistre ce que le joueur a validé.
- L'extraction valide **champ par champ** : un âge fantaisiste ne doit pas emporter le nom et la personnalité. Ce qui ne tient pas part dans `missing`, et l'écran le demande.
- Deux appels distincts, conversation et extraction. Mêler une réponse adressée au joueur et une structure destinée à la base ferait porter deux rôles au même texte.
- Le message du joueur est écrit **avant** l'appel au modèle : une coupure en cours de réponse ne doit pas lui faire perdre ce qu'il a tapé. La réponse, elle, n'est écrite que si elle est complète.
- La conversation ne voit **rien des œuvres citées**. Le joueur les a écrites, donc il n'y aurait pas de fuite à les lui renvoyer, mais la fiche repart ensuite dans les prompts de génération.
- En revanche le **nom du personnage n'est pas soumis à la garde sur les emprunts** : le joueur nomme son personnage, c'est sa décision. La garde protège le monde généré, pas les choix du joueur.
- Le coût est borné par le nombre de tours (`CHARACTER_TURNS_MAX`), pas par une limite d'adresse : le joueur est authentifié. `CHARACTER_TURNS_MIN` décide quand la fiche devient extractible.
- Le premier message n'est pas enregistré : tant que le joueur n'a rien dit, il n'y a pas de conversation, et l'écrire en créerait une que l'extraction compterait pour rien.
- `apps/web/src/lib/sse.ts` porte le lecteur de flux, partagé par le guide et la conversation. Ne pas le recopier dans un troisième appelant.

## Génération de monde

La passe d'abstraction convertit ce que le joueur a cité en thèmes, et c'est la **seule étape de toute la chaîne à voir les titres**. Tout ce qui suit ne reçoit que `WorldThemes`.

La garde sur la propriété intellectuelle a trois étages, et aucun ne suffit seul :

1. Le prompt `abstraction/v1` interdit les noms propres en sortie. Un modèle oublie une consigne.
2. `WorldThemesSchema` les refuse champ par champ, via `findProperNouns`. Un schéma ne lit pas une intrigue.
3. `findBorrowedNames` relit la prose produite contre les titres saisis. Un contrôle ne voit que ce qu'il sait chercher.

- `findProperNouns` tient une majuscule hors tête de phrase pour un nom propre. La règle est grossière et se trompe dans le sens du refus : une relance coûte moins qu'un monde emprunté.
- `findBorrowedNames` ne compare que les mots **capitalisés**, et ignore les titres d'un seul mot en minuscules : sinon un monde désertique inspiré de Dune ne pourrait plus parler de dunes. La comparaison porte sur des mots entiers, jamais sur des sous-chaînes.
- Le modèle de narration **se choisit par évaluation**, pas par réputation. `LLM_NARRATOR_CANDIDATES` porte les modèles à comparer, `pnpm --filter @odyssai/api eval:narration` les fait tourner sur `packages/narrator/evals/abstraction.fr.jsonl`, et le gagnant se reporte dans `LLM_NARRATOR_MODEL`. Vide, `NarratorConfig.configured` est faux et l'api démarre quand même : aucune route ne lit la narration.
- Les évaluateurs sont en code, sans LLM juge. Le plus sévère est `no_banned_name` : une liste écrite à la main, cas par cas, des noms qui ne doivent pas survivre à l'abstraction.
- **Une sortie rejetée vaut zéro sur les contrôles de sûreté**, pas un. Sa prose est vide, donc elle passerait tout sans rien avoir produit, et un modèle incapable de répondre s'afficherait comme le plus sûr de tous.
- Les noms interdits se cherchent sur des **mots entiers**, comme dans `findBorrowedNames`. En sous-chaîne, « San » se trouve dans « sans » et « paysan », et faisait échouer des sorties propres.
- Un modèle `:free` d'OpenRouter qui note 0 % n'est pas mauvais, il est **bridé** : sous la charge continue de l'évaluation son palier gratuit se ferme. Le mesurer demande de le lancer seul.
- `eval:narration` n'entre pas dans `make check` et consomme des appels réels : une exécution vaut le nombre de cas multiplié par le nombre de candidats.

## Worker et graphe de génération

`apps/worker` consomme la file BullMQ `odyssai-generation` et exécute le graphe LangGraph. Le graphe vit dans `packages/narrator`, sa persistance dans le worker : narrator ne connaît pas Postgres.

- **Redis transporte, Postgres enregistre.** `generation_jobs` porte l'étape, le statut et l'erreur ; les travaux finis ne sont pas gardés en Redis, ce qui empêcherait une relance, l'identifiant du travail étant celui de l'univers.
- L'identifiant du travail est l'`universeId` : deux requêtes concurrentes du même joueur ne lancent qu'une génération. La base ne peut pas garantir ça seule, rien n'y empêchant deux lectures concurrentes de voir la même étape.
- **Reprendre un fil se fait en passant `null` en entrée.** Passer l'entrée complète fait repartir le graphe du début même quand un checkpoint existe. C'est `getState().next` qui dit s'il y a quelque chose à reprendre.
- La **passe d'abstraction reste hors du graphe** : elle est la seule à voir les titres, et l'avoir à part rend la frontière visible. Ses thèmes sont écrits en base dès qu'ils existent, ce qui vaut point de reprise et donne en plus une donnée interrogeable.
- Les nœuds du graphe sont préfixés `write_` : LangGraph refuse qu'un nœud porte le nom d'un canal d'état, et `charter` ou `lore` sont les deux à la fois.
- Un nœud rejoue **deux fois** une sortie illisible ou refusée par le schéma. Une erreur de transport, elle, remonte tout de suite : c'est BullMQ qui la relance, avec son délai, et le checkpointer fait reprendre au bon nœud.
- L'écriture finale est **une seule transaction** : un monde à moitié écrit avec une étape `ready` serait pire qu'un échec, le joueur y entrerait sans lore.
- Le contrôle final rejoue le lore **une fois** si un nom emprunté apparaît. Au delà, la génération échoue : une boucle qui insiste coûterait sept appels par tour sans garantie de converger.
- Les tables du checkpointer appartiennent à LangGraph, pas à Prisma : `setup()` les crée au démarrage, aucune migration ne les décrit.
- Le `dev` du worker lance **deux processus** : `tsc --watch` émet, `node --watch` relit `dist`. Node ne sait pas exécuter les sources directement, son stripping de types ne réécrivant pas les spécificateurs `.js` en `.ts`. La compilation initiale précède le watch, sans quoi node démarrerait sur un `dist` absent.
- **`packages/narrator` est en CommonJS**, donc ses déclarations résolvent `@langchain/*` par la condition `require` alors que le worker, en ESM, les résout par `import`. Même classe à l'exécution, deux identités de type : `apps/worker/src/generate.ts` prend le type de narrator pour que la seule conversion reste au point d'entrée.

## Écran de génération et coquille de jeu

- L'avancement se lit dans `generation_jobs` par un `GET /onboarding/generation` en SSE, qui relit la table toutes les deux secondes. **Pas de canal Redis publié par le worker** : la table est déjà la source de vérité, elle survit à un redémarrage, et deux instances d'api y lisent la même chose.
- Le flux se ferme de lui-même au bout de dix minutes et le navigateur rouvre : une génération peut traîner, pas indéfiniment.
- `GET /world` sert le monde **par une projection**, `WorldViewSchema`, qui ne porte pas le `secret` des personnages. C'est le schéma qui le garantit, pas un `delete` : un champ qu'un type ne porte pas ne fuite pas par distraction. Un test e2e vérifie que le mot n'apparaît nulle part dans la réponse.
- L'étape `failed` rouvre l'inspiration dans l'assistant : c'est la seule sortie d'une génération qui n'a pas abouti, et l'API l'accepte en écriture pour cette raison.
- Le titre de la page est porté par `OnboardingWizard`, pas par `page.tsx` : une fois le monde généré, l'écran n'est plus un parcours et n'en veut plus.
- La teinte du monde passe par `--world-hue` sous `[data-world]`, comme le kit le prévoit. Ne pas écrire `--accent` à la main : ce serait contourner la règle au lieu de la suivre, et perdre sa transition.
- Le champ de saisie du tour de jeu est **présent et inerte**, et le dit. Le tour n'existe pas encore, et faire croire l'inverse serait pire qu'une absence.

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
