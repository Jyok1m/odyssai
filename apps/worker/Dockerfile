# syntax=docker/dockerfile:1
#
# Le contexte de build est la RACINE du monorepo, pas ce dossier :
#   docker build -f apps/worker/Dockerfile -t odyssai-worker .

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Ni apps/api ni apps/web : un manifeste present est un membre du workspace,
# dont `pnpm deploy` exige ensuite les dependances internes. Copier celui de
# l'api obligeait a suivre ici les paquets qu'elle seule utilise.
COPY apps/worker/package.json apps/worker/
COPY packages/schemas/package.json packages/schemas/
COPY packages/db/package.json packages/db/
# engine : le semis des entites a l'ecriture du monde. Oublie ici, le build
# passait en local (le workspace entier est present) et tombait dans l'image.
COPY packages/engine/package.json packages/engine/
COPY packages/llm/package.json packages/llm/
COPY packages/narrator/package.json packages/narrator/
# --child-concurrency=1 : l'extraction de plusieurs centaines de paquets en
# parallele est ce qui fait tomber le build sur une petite machine, pas le
# telechargement.
RUN pnpm install --frozen-lockfile --child-concurrency=1 --filter=@odyssai/worker...

COPY packages/schemas packages/schemas
COPY packages/db packages/db
COPY packages/engine packages/engine
COPY packages/llm packages/llm
COPY packages/narrator packages/narrator
COPY apps/worker apps/worker

# turbo n'est pas installe par l'install filtree : on ordonne a la main. C'est
# aussi pourquoi `generate` s'appelle ici : le client Prisma est une tache turbo
# a part, dont `build` depend, et non un prescript de `build`. Sans elle tsc ne
# trouve pas le client et packages/db ne compile pas. engine depend de schemas,
# narrator de llm et de schemas.
RUN pnpm --filter @odyssai/schemas build \
 && pnpm --filter @odyssai/db generate \
 && pnpm --filter @odyssai/db build \
 && pnpm --filter @odyssai/engine build \
 && pnpm --filter @odyssai/llm build \
 && pnpm --filter @odyssai/narrator build \
 && pnpm --filter @odyssai/worker build

# --legacy est necessaire car le workspace n'active pas
# inject-workspace-packages, et l'activer changerait le comportement de
# l'install en developpement.
RUN pnpm --filter @odyssai/worker deploy --prod --legacy /out

# `prisma` et `typescript` sont des peers OPTIONNELS de @prisma/client : pnpm
# les resout parce qu'ils existent dans le workspace, et deploy emporte tout
# leur graphe, soit le studio, son Postgres embarque et le moteur de requete.
# Rien ne les requiert a l'execution : la CLI n'a servi qu'a generer le client,
# et la connexion passe par l'adaptateur pg.
RUN rm -rf /out/node_modules/.pnpm/prisma@* \
           /out/node_modules/.pnpm/typescript@* \
           /out/node_modules/.pnpm/@prisma+studio-core@* \
           /out/node_modules/.pnpm/@prisma+engines@* \
           /out/node_modules/.pnpm/@electric-sql+pglite@* \
           /out/node_modules/.pnpm/effect@* \
           /out/node_modules/.pnpm/elkjs@*

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out ./
USER node
# Aucun port : le worker ne sert rien, il consomme la file.
CMD ["node", "dist/main.js"]
