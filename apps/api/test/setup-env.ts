/**
 * AppModule valide sa configuration a l'instanciation : sans ces variables, le
 * module ne se construit pas. Redis est double dans chaque suite.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3001',
  API_BASE_URL: 'http://localhost:3001',
  WEB_BASE_URL: 'http://localhost:3000',
  KEYCLOAK_ISSUER: 'https://sso.example.test/realms/odyssai-test',
  KEYCLOAK_CLIENT_ID: 'odyssai-api',
  KEYCLOAK_CLIENT_SECRET: 'secret-de-test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  POSTGRES_URL: 'postgresql://odyssai:secret@127.0.0.1:5432/odyssai_test',
});
