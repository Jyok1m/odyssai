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
RUN pnpm install --frozen-lockfile --filter=@odyssai/api...

COPY packages/schemas packages/schemas
COPY apps/api apps/api

RUN pnpm --filter @odyssai/schemas build \
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
