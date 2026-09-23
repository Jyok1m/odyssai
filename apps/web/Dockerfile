# syntax=docker/dockerfile:1
#
# Le contexte de build est la RACINE du monorepo, pas ce dossier :
#   docker build -f apps/web/Dockerfile -t odyssai-web .
# Le lockfile et packages/schemas vivent à la racine.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack lit `packageManager` de la racine : une seule source de vérité
# pour la version de pnpm, ici comme en local.
RUN corepack enable
WORKDIR /app

FROM base AS build
# Les manifestes d'abord, pour que la couche d'install reste en cache tant
# que les dépendances ne changent pas. --frozen-lockfile compare le lockfile
# à tous les projets du workspace : il faut donc les trois package.json,
# même celui de l'api qu'on ne construit pas ici.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/schemas/package.json packages/schemas/
RUN pnpm install --frozen-lockfile --filter=@odyssai/web...

COPY packages/schemas packages/schemas
COPY apps/web apps/web

# SITE_URL est lue pendant le prerender : /fr et /en sont statiques, donc
# canonical, OpenGraph, sitemap et JSON-LD sont figés à ce moment. La passer
# au runtime seul ne suffirait pas pour ces pages.
ARG SITE_URL=http://localhost:3000
ENV SITE_URL=$SITE_URL

# Les variables NEXT_PUBLIC_ sont inscrites en dur dans le bundle navigateur
# au moment du build : les fournir au runtime n'aurait aucun effet. L'image
# est donc liée à son environnement, comme pour SITE_URL.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Cle publique du widget Turnstile, visible dans le HTML : ce n'est pas un
# secret, mais elle est liee au hostname declare chez Cloudflare, donc a
# l'environnement. Le defaut est la cle de test, qui accepte tout.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

# turbo n'est pas installé par l'install filtrée : on ordonne à la main.
RUN pnpm --filter @odyssai/schemas build \
 && pnpm --filter @odyssai/web build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: standalone` conserve l'arborescence du workspace : le serveur
# atterrit dans apps/web/, avec un node_modules élagué à la racine.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
