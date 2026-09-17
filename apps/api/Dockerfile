# syntax=docker/dockerfile:1
#
# Le contexte de build est la RACINE du monorepo, pas ce dossier :
#   docker build -f apps/api/Dockerfile -t odyssai-api .

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/llm/package.json packages/llm/
COPY packages/narrator/package.json packages/narrator/
# --child-concurrency=1 : l'extraction de cinq cents paquets en parallele est
# ce qui fait tomber le build sur une petite machine, pas le telechargement.
RUN pnpm install --frozen-lockfile --child-concurrency=1 --filter=@odyssai/api...

COPY packages/schemas packages/schemas
COPY packages/llm packages/llm
COPY packages/narrator packages/narrator
COPY apps/api apps/api

# turbo n'est pas installe par l'install filtree : on ordonne a la main, et
# narrator depend de llm et de schemas.
RUN pnpm --filter @odyssai/schemas build \
 && pnpm --filter @odyssai/llm build \
 && pnpm --filter @odyssai/narrator build \
 && pnpm --filter @odyssai/api build

# Sort un dossier autonome : @odyssai/schemas y est recopié en vrais
# fichiers, sans lien vers le workspace. --legacy est nécessaire car le
# workspace n'active pas inject-workspace-packages, et l'activer changerait
# le comportement de l'install en développement.
RUN pnpm --filter @odyssai/api deploy --prod --legacy /out

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
