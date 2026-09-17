# syntax=docker/dockerfile:1
#
# Le contexte de build est la RACINE du monorepo, pas ce dossier :
#   docker build -f packages/db/Dockerfile -t odyssai-migrate .
#
# Image jetable : elle applique les migrations en attente, puis sort. Elle
# existe parce que l'image de l'api retire volontairement la CLI Prisma et ses
# moteurs, inutiles pour servir du trafic (voir apps/api/Dockerfile). Migrer
# depuis l'api reviendrait a lui rendre ces 190 Mo et a laisser un outil
# d'ecriture de schema dans le conteneur qui repond aux joueurs.

# Le moteur de migration est un binaire natif, et il en existe une variante par
# version d'OpenSSL. L'image slim n'embarque pas la bibliotheque : sans elle,
# Prisma retombe sur la variante 1.1.x en avertissant a chaque appel, et le
# jour ou la base exigera TLS l'avertissement deviendrait une panne.
FROM node:24-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/
# Sans --prod : la CLI Prisma est une devDependency de @odyssai/db, et c'est
# tout l'objet de cette image.
RUN pnpm install --frozen-lockfile --child-concurrency=1 --filter=@odyssai/db...

# turbo, que le package.json de la racine emporte, ne sert qu'a orchestrer un
# build. Le reste du graphe reste : la CLI Prisma 7 charge @prisma/config, donc
# `effect`, et son cli.js requiert @prisma/studio-core des le demarrage, y
# compris pour un simple `migrate deploy`.
RUN rm -rf node_modules/.pnpm/@turbo+* node_modules/.pnpm/turbo@*

# Le paquet entier : le schema, les migrations, prisma7.config.ts, et le
# src/env.ts que ce dernier importe.
COPY packages/db packages/db

FROM base AS runner
# La CLI decouvre prisma7.config.ts dans le repertoire courant, et c'est lui
# qui porte POSTGRES_URL. Aucun .env n'est embarque : loadRootEnvFile n'en
# trouve pas et laisse l'environnement du conteneur tel quel.
WORKDIR /app/packages/db
COPY --from=build --chown=node:node /app /app
USER node
# deploy, jamais dev : applique les migrations existantes, n'en ecrit aucune,
# et refuse d'agir sur une base qui aurait derive au lieu de la reinitialiser.
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
