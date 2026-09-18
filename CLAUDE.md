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

Redis tourne en tunnel localhost sur le serveur via `redis://:<mot_de_passe>@localhost:16379` (sessions et file BullMQ). Postgres est atteint de la même façon, sur `127.0.0.1:15432`, par `POSTGRES_URL`. `make tunnel` ouvre les deux ports. Keycloak est hébergé sur `sso.joachimjasmin.com`.

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
- **Les migrations sont appliquées par le déploiement, pas par l'api.** `packages/db/Dockerfile` produit `odyssai-migrate`, un conteneur jetable qui porte la CLI, le schéma et les migrations ; le Jenkinsfile le lance (`compose run --rm migrate`) entre le `pull` et le `up -d`. L'image de l'api retire volontairement la CLI Prisma et ses moteurs : lui faire migrer la base lui rendrait ces 190 Mo et laisserait un outil d'écriture de schéma dans le conteneur qui répond aux joueurs. Le service `migrate` vit dans le profil `tools` du compose, hébergé par le rôle ansible, pour ne jamais démarrer avec les autres.
- Migrer **avant** de basculer les images, donc l'ancien code tourne quelques secondes sur le nouveau schéma : une migration doit rester lisible par la version qu'elle remplace. Une colonne se retire en deux déploiements, jamais dans celui qui cesse de l'écrire.
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
- Les verbes ouverts au navigateur sont listés dans `apps/api/src/config/cors.ts`, **pas dans `main.ts`** : la configuration y serait hors du graphe de modules, donc invisible aux tests. **Toute route servie sous un nouveau verbe s'ajoute à `CORS_METHODS`.** Sans cela elle marche depuis curl et depuis supertest, qui n'émettent pas de préflight, et échoue dans un navigateur seul. `test/cors.e2e-spec.ts` monte l'application avec la vraie configuration et vérifie le préflight de chaque verbe.
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

## Partir : recommencer, supprimer son compte

`DELETE /onboarding` recommence une partie, `DELETE /me` efface le compte. Les deux passent par `ErasureService` (`apps/api/src/erasure/`), un module à part : `MeController` vit dans `AuthModule`, qu'`OnboardingModule` importe déjà, et l'inverse ferait un cycle.

- **Deux questions indépendantes**, pas une. Un personnage rencontré ailleurs est gardé avec `died_at` posé ; un monde visité est gardé, détaché. Un personnage voyage, donc il peut avoir été rencontré sans que son monde ait reçu qui que ce soit.
- `encounters.universe_id` est l'univers **où** la rencontre a eu lieu, pas celui d'où vient le personnage. C'est ce qui rend les deux questions réellement indépendantes, et un test l'a démontré en échouant sur une fixture qui les confondait.
- Personne n'écrit dans `encounters` : la traversée entre univers reste à construire. Les deux prédicats sont donc faux et tout est supprimé, ce qui est juste tant que personne ne peut se croiser.
- Un monde gardé est **vidé des mots du joueur** : `works`, `own_description` et toute la conversation de création. Ce qui reste est le texte du modèle, sans lien avec une personne. C'est ce qui permet de le conserver sans trahir la page Confidentialité, qui le dit désormais explicitement.
- `universes.owner_id` et `characters.universe_id` sont nullables en `SetNull`, pas en `Cascade` : c'est le service qui décide du sort d'un monde, pas la base. Contrepartie, supprimer un utilisateur à la main laisse son monde orphelin. Le worker refuse de générer pour un monde sans propriétaire.
- **L'API n'a aucun droit sur Keycloak**, et n'en gagne aucun : `DELETE /me` efface le jeu et ferme la session, puis rend `accountUrl` pour que le joueur supprime son identité lui-même. Le rôle ansible active pour cela l'action requise `delete_account` et le rôle client `account/delete-account`.
- La confirmation est un **mot à taper** (`DangerAction`), pas une case ni un second clic : les deux s'obtiennent par réflexe, recopier un mot demande de lire.

### Le checkpointer LangGraph vit dans son propre schéma

`PostgresSaver` est construit avec `schema: 'langgraph'`. Dans `public`, ses tables étaient invisibles de Prisma, et **chaque `migrate diff` proposait de les supprimer**, ce qui aurait effacé l'état de reprise des générations en cours. Ne pas l'y ramener.

## Le tour de jeu

Le narrateur est un meneur : il mène, le joueur répond. `POST /turn` en SSE, `GET /turn` pour reprendre. `packages/engine` porte les règles, pures, sans base ni modèle.

- **Le code lance le dé à chaque tour**, avec `randomInt` et non `Math.random`. Pas de classement préalable pour décider s'il faut lancer : ce serait le modèle qui déciderait. Il ne reçoit qu'une **bande**, jamais le chiffre, et la consigne de ne s'en servir que si l'issue était incertaine.
- Le joueur voit **deux états**, favorable ou défavorable, et seulement quand le dé a servi. Le jet brut est gardé dans `turns` : c'est ce qui permet de vérifier après coup qu'un dé n'était pas truqué.
- `splitTail` (`packages/narrator/src/turn/`) sépare le récit du bloc structuré. C'est **l'inverse de `splitOffTopic`** : sa sentinelle est en tête et il décide avant le premier octet, ici le marqueur est en queue et la prose part au fil de l'eau. Il faut donc retenir en permanence le plus long suffixe qui pourrait être un début de marqueur.
- **Le départ du joueur arrête la diffusion, pas la génération.** Le bloc de queue doit arriver pour que le canon s'écrive, et le tour doit s'enregistrer pour qu'il le retrouve. C'est l'inverse du guide, où couper l'appel amont est juste.
- Le meneur **rend toujours la main en demandant ce que le joueur fait**, mais sur la situation nouvelle. La consigne « quelque chose a changé » et celle « pose une question » ne s'opposent pas : elles se tiennent. S'il n'a rien de neuf à demander, c'est que rien n'a bougé, et c'est cela le défaut.
- **Le meneur répond dans la langue du joueur.** La langue est détectée par le classificateur de modération, qui lit déjà le message : une détection séparée coûterait un appel ou une dépendance. Dès qu'elle n'est pas le français, les consignes prennent leur version anglaise, **pour ce tour seulement**. Le compte n'est pas touché : une phrase lâchée en anglais ne doit pas faire basculer tout le site de quelqu'un.
- Le prompt du meneur est en **v3**. La v1 était cryptique et tournait en boucle : elle demandait de « terminer sur une ouverture », ce que le modèle traduisait par une question à chaque tour. La v2 exige que **quelque chose ait changé** à la fin du tour, interdit de reposer la même question, impose de trancher à la place d'un joueur qui hésite, et bannit le registre oraculaire au profit du concret.
- `readDelta` ne jette jamais : le récit est déjà parti au joueur quand elle s'exécute. Un bloc absent ou illisible laisse le tour debout, seul le canon ne grandit pas.
- Un fait inventé passe par `arbitrateCanon` : refusé s'il contredit un interdit de la charte, refusé s'il emprunte un nom. Le canon nourrit tous les tours suivants, donc un interdit franchi une fois ne se referme plus.
- `conversation_messages.seq` est le rang explicite. L'ordre d'un journal de partie ne peut pas dépendre d'une horloge à la milliseconde, le message et sa réponse s'écrivant dans la même transaction.
- **La mémoire longue se dégrade proprement.** `TurnMemoryService` sonde l'extension `vector` au démarrage : absente, le meneur ne se souvient que des douze derniers tours et la partie reste jouable. La sonde est dans un `try`, pas un `.catch` : un client réduit jette avant d'avoir une promesse à rejeter, et une sonde de capacité ne doit jamais faire tomber le démarrage.
- L'image Postgres doit être `pgvector/pgvector:pg18`. L'officielle n'embarque pas l'extension.
- `TurnLimitsService` **importe** le script Lua du guide plutôt que de le recopier : il ne connaît que ses clés. La clé est ici l'identifiant du joueur, l'anonymisation HMAC n'ayant plus d'objet pour un authentifié.

## Modération

Deux couches, dans cet ordre, sur tout ce qu'un joueur écrit.

- **Lexicale d'abord** (`packages/engine/src/moderation.ts`) : instantanée, gratuite, elle arrête ce qui est manifeste avant tout appel et avant toute écriture.
- **Classificateur ensuite** (`moderation/v1`) : un petit modèle de conversation. **Aucun point de modération dédié n'est joignable** avec les clés du projet, vérifié : OpenRouter répond 404 sur `/moderations` et la clé OpenAI est vide. Un verdict illisible ou un modèle injoignable valent acceptation : la couche lexicale a déjà tourné, et un classificateur en panne ne doit pas empêcher de jouer.
- La liste lexicale est **délibérément courte**. Trois racines ont été retirées après avoir fait tomber du français courant : `retard` (mot de tous les jours), `fag` (attrapait « fagot »), `rape` (tout fromage râpé une fois les accents défaits). Les manquer est le prix ; le classificateur lit la phrase, pas les lettres.
- La comparaison est **toujours sur des mots entiers**, jamais en sous-chaîne, et l'écrasement des répétitions ne touche que les étirements de trois lettres ou plus : à deux, `faggot` devenait `fagot`. Un mot épelé (« c.o.n.n.a.r.d ») n'est recollé que sur une suite d'au moins quatre lettres isolées, signature d'un contournement et non d'une phrase.
- **Le mot reconnu ne repart jamais au joueur**, seulement la raison : le renvoyer reviendrait à le republier.
- La réponse du meneur est relue par la couche lexicale seule. Un second appel de classification retarderait un récit déjà parti.

## Ce que les modèles coûtent

`llm_usage` journalise **chaque** appel, quel qu'en soit le point de départ. Avant lui, cinq des huit points d'appel jetaient leur usage, dont la génération d'un monde, qui en fait sept à vingt-trois : la donnée était calculée par `narrator` et personne ne la lisait.

- Sans ce journal, aucun barème d'abonnement ne peut être autre chose qu'une opinion. **On ne tarife pas ce qu'on ne mesure pas.**
- `cost_usd` est un `Decimal(12,8)`, pas un `Float` : un coût s'additionne sur des milliers de lignes et le binaire y dérive.
- La relation vers `users` est en **`SetNull`** : la comptabilité survit au départ d'un joueur, détachée de lui. Ce qui reste est un coût, plus une personne.
- Une écriture ratée est journalisée, jamais relancée : le joueur a déjà reçu sa réponse, et la comptabilité ne vaut pas de casser un tour. Même règle que le journal du guide.
- `guide_questions` garde son propre journal et **reste anonyme** : il n'a aucun joueur à rattacher, et c'est une décision de conception, pas un oubli.
- Le coût rendu par le fournisseur prime ; sinon il se calcule depuis les jetons, en facturant les jetons de raisonnement au tarif de sortie, ce que font les deux fournisseurs.

### `prisma generate` est une tâche turbo à part

`build` et `typecheck` de `packages/db` l'appelaient chacun de leur côté, et turbo les lance en parallèle : les deux `mkdir` du même répertoire généré se marchaient dessus (`EEXIST`). Ça ne se voyait qu'avec un cache froid. La génération est maintenant une tâche `generate` dont `build`, `typecheck` et `dev` dépendent. **Ne pas la remettre dans les scripts.**

## Crédits et abonnements

Le joueur achète des **crédits**, tarifés par action : un tour en vaut un, un monde vingt-cinq. Le barème est dans `packages/engine/src/credits.ts`, en constantes, et le rapport entre un crédit et son coût réel se règle là sans toucher à Stripe.

- **Postgres est la vérité des crédits, pas Redis.** Le budget du guide vit en Redis parce qu'il est anonyme, très fréquent et approximatif : une éviction y coûte une estimation. Un crédit est facturé, et une éviction effacerait la consommation d'un mois payé.
- **On débite avant l'appel et on rembourse s'il échoue.** Le prix d'une action est connu d'avance, contrairement au budget en dollars du guide : il n'y a pas de danse réserver puis régler à reproduire.
- `credit_entries` est en **ajout seul** et fige le solde de chaque écriture : relire le grand livre des années plus tard doit rendre ce que le joueur a vu, même si le barème a changé.
- Le roulement de période est **paresseux, à la lecture**. Une tâche nocturne ferait le même travail en moins fiable et laisserait un joueur sans réserve jusqu'à son passage.
- Les crédits **ne se reportent pas** : la réserve est remise à la dotation du plan, jamais augmentée. Sinon un joueur absent six mois reviendrait avec six mois d'avance.
- La modération et les embeddings ne sont **jamais facturés** : faire payer au joueur le fait qu'on le surveille serait indéfendable.

### Stripe

La clé et le secret de webhook sont les seules variables d'environnement. Les paliers et leurs identifiants de prix vivent en base (voir le tableau de bord d'administration) : en variable, mettre un palier en vente demandait un déploiement.

- Tout est facultatif. Sans `STRIPE_PRIVATE_KEY`, `BillingConfig.enabled` est faux, la vente se tait et le palier libre suffit à jouer : on développe sans compte Stripe.
- **`ODYSSAI_ENV`, pas `NODE_ENV`.** Les deux copies du site tournent avec `NODE_ENV=production`, l'image étant la même : il ne peut pas les distinguer. `ODYSSAI_ENV` vaut `production` sur la vraie et `staging` sur celle de dev, et lui seul décide du mode Stripe autorisé.
- Une clé `sk_live_` est refusée au démarrage hors `ODYSSAI_ENV=production`, une `sk_test_` à l'intérieur. Le secret de webhook devient obligatoire dès qu'une clé est présente : une clé sans secret vendrait un abonnement que rien ne créditerait.
- `NestFactory.create(AppModule, { rawBody: true })`, et `@Req() req: RawBodyRequest<Request>` dans le contrôleur. La signature se calcule sur les octets reçus : le JSON re-sérialisé par Nest ne les reproduit pas. `test/billing.e2e-spec.ts` le vérifie de bout en bout, c'est sa raison d'être.
- **L'entitlement ne vient que du webhook**, jamais de la redirection de succès, qu'un joueur peut appeler à la main.
- L'idempotence est la **clé primaire de `stripe_events`** : Stripe rejoue jusqu'à obtenir un 2xx, et un `invoice.paid` traité deux fois créditerait deux fois.
- **L'ordre des webhooks n'est pas garanti.** `invoice.paid` peut précéder `customer.subscription.created` : le renouvellement relit donc l'abonnement chez Stripe avant de créditer, sans quoi un joueur qui vient de payer recevrait la dotation du palier libre.
- Un prix inconnu est ignoré, jamais deviné : le prendre pour le palier libre ferait retomber un abonné payant.
- `invoice.payment_failed` ne coupe rien. Stripe relance plusieurs jours, et c'est `customer.subscription.deleted` qui tranche.
- Le garde est posé **méthode par méthode** sur `BillingController` : le webhook n'a pas de session.
- Checkout Session pour souscrire, Customer Portal pour gérer et résilier. Aucune saisie de carte chez nous : l'héberger ferait entrer le projet dans le périmètre PCI sans rien apporter.
- En développement : `stripe listen --forward-to localhost:3001/billing/webhook` donne le secret à mettre dans `STRIPE_WEBHOOK_SECRET`.
- `GET /billing/catalog` est **public** : le barème n'a rien de personnel, et une page de tarifs doit s'afficher avant l'inscription. `purchasable` y est faux tant qu'un plan n'a pas de prix configuré, et l'écran cache alors l'offre au lieu d'offrir un bouton qui répondrait 503.
- Le nom d'un palier vient de la base, jamais d'une clé de traduction : les paliers se créent au tableau de bord, et leurs noms ne sont pas connus à la compilation.
- Aucun montant en euros dans le code : les prix vivent chez Stripe, qui les affiche sur sa propre page. Les recopier ferait deux vérités, et la fausse serait la nôtre.
- L'URL de retour après Stripe est **construite côté serveur** depuis `user.locale`, jamais reçue du navigateur : accepter une URL de retour du client ouvrirait une redirection arbitraire. Les deux chemins localisés y sont recopiés de `routing.ts`, faute de source partagée entre les deux applications.

## Tableau de bord d'administration

`/admin`, **hors du segment `[locale]` et hors du proxy next-intl**, en français seul : un back-office que seul l'administrateur voit n'a pas d'audience anglophone, et le traduire aurait doublé chaque libellé pour personne. `admin` est donc exclu du `matcher` de `src/proxy.ts`, sans quoi `/admin` serait redirigé vers `/fr/admin`, où rien ne répond.

- **L'ordre des gardes compte.** `SessionGuard` dépose le joueur sur la requête, `AdminGuard` le relit. Inversés, le second ne verrait rien et laisserait tout passer : `test/admin.e2e-spec.ts` le vérifie route par route, et le test unitaire du garde couvre le cas « aucune session résolue ».
- **`users.is_admin` n'est modifiable par aucune route**, pas même par le tableau de bord. Un dashboard capable de nommer des administrateurs transforme une session volée en prise de contrôle définitive. Le droit se pose avec `pnpm --filter @odyssai/api admin:grant <email>`, donc avec un accès au serveur.
- Le garde côté web est une commodité, jamais une sécurité : il évite d'afficher des tableaux vides et des 403, c'est tout.
- Un ajustement de réserve passe par le grand livre, avec un **motif obligatoire** : il est en ajout seul, et un solde remis à zéro doit s'y lire comme un mouvement daté, pas comme un trou. Le solde ne descend jamais sous zéro.
- La liste des joueurs pagine **par curseur** : elle s'allonge pendant qu'on la lit, et un décalage par numéro de page ferait sauter ou répéter des lignes. L'`id` étant un uuid v7, l'ordre décroissant suffit.
- La résiliation d'un abonnement n'écrit **pas** le retour au palier libre : il viendra du webhook `customer.subscription.deleted`, seule source du droit. L'écrire tout de suite ferait diverger nos lignes de celles de Stripe si l'appel échouait à mi-chemin.
- Les primitives visuelles vivent dans `components/admin/ui.tsx` et non dans `components/ui` : le kit habille le jeu, elles habillent un back-office. Les tokens, eux, sont bien ceux du kit.
- `components/admin/confirm.tsx` double `ui/danger-action` parce que celui-ci tire ses textes de next-intl, que `/admin` n'a pas. Le même mot à taper des deux côtés, pour ne pas avoir deux réflexes à apprendre.

### Les paliers vivent en base

`packages/engine` ne porte plus que le barème par action, `FREE_PLAN_SLUG` et les bornes. Les paliers sont des lignes de `plans`, éditables depuis le tableau de bord : changer une dotation ne doit pas demander un déploiement.

- L'objection d'origine (une table rendrait la base propre à un environnement) **ne tient pas** : les deux copies du site ont déjà leur propre Postgres, et un prix du mode test n'a de sens que dans la base de dev. `STRIPE_PRICE_*` a donc disparu de la configuration.
- **L'amorçage des trois paliers est dans la migration**, pas dans un script : la clé étrangère posée juste après échouerait sur les abonnements existants, et une migration qui laisse la base invalide entre deux commandes n'en est pas une.
- `subscriptions.plan` référence `plans.slug` et non l'uuid : c'est le slug qui voyage dans les contrats HTTP et se relit dans un journal. La clé étrangère empêche de supprimer un palier que quelqu'un porte.
- **Le palier libre est protégé** de l'archivage comme de la suppression : tout y retombe, et un abonnement sans palier n'est plus lisible.
- `PlansService` **ne met rien en cache** : une lecture de plus par tour est négligeable devant l'appel au modèle qui suit, et un cache ferait vivre un joueur sur une dotation que l'administrateur croit avoir changée.
- **Un prix Stripe est immuable.** Changer un montant crée un nouveau prix et désactive l'ancien ; les abonnés en cours gardent le leur jusqu'à leur prochaine facture, Stripe ne rejouant pas un abonnement sur un nouveau prix. C'est le piège central d'`AdminPlansService`.
- Les écritures chez Stripe passent **avant** l'écriture en base : un produit créé sans ligne chez nous se voit et se nettoie, une ligne qui pointe un prix inexistant ferait échouer un paiement. Les créations portent une clé d'idempotence dérivée du slug.
- Un prix n'est jamais supprimé chez Stripe, seulement désactivé : les factures passées y renvoient.
- Un seul client Stripe, fourni par `StripeModule` : trois `new Stripe(...)` finiraient par diverger sur la version d'API, ce qui se verrait au pire moment.

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
- **Le focus d'un champ est porté par sa bordure, jamais par un liseré.** Les deux ensemble font un double cadre. Tout conteneur de champ porte donc `data-focus-ring="container"`, qui neutralise le liseré global de `globals.css` ; sans lui le navigateur ajoute le sien par dessus, et `outline-none` en classe n'y peut rien, la règle étant hors `@layer`.
- Le style d'un champ vit dans `apps/web/src/components/ui/field.ts` (`FIELD`, `FIELD_AREA`, `FIELD_DANGER`). Ne pas le recopier. Deux exceptions assumées et commentées : une bordure conditionnelle et un `select`.

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
