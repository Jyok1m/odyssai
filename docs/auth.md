# Authentication

One Keycloak realm per environment (`odyssai-dev`, `odyssai-prod`). `apps/api` is its only client, confidential.

- Login and signup are served by Keycloak. `GET /auth/signin` targets the authorization endpoint, `GET /auth/signup` targets `/protocol/openid-connect/registrations`.
- The realm is not configured from this repo: the ansible role `keycloak` of the infrastructure repo describes it end to end through the Admin REST API, and it is the source of truth, not the web console.
- The verbs open to the browser are listed in `apps/api/src/config/cors.ts`, **not in `main.ts`**: the configuration would be outside the module graph there, hence invisible to tests. **Any route served under a new verb is added to `CORS_METHODS`.** Without that it works from curl and from supertest, which emit no preflight, and fails in a browser alone. `test/cors.e2e-spec.ts` boots the application with the real configuration and checks the preflight of every verb.
- The `odyssai` theme dresses the realm pages and lives in the same ansible role. Its CSS redeclares the tokens of `globals.css`, Keycloak not compiling Tailwind: report any evolution of the kit there.
