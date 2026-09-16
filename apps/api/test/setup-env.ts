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

  // Guide. Le tracing est coupe et les cles sont factices : aucun appel ne
  // sort, aucune trace ne part, meme si le .env racine en contient de vraies.
  LANGSMITH_TRACING: 'false',
  LANGSMITH_API_KEY: 'ls-factice',
  OPENROUTER_API_KEY: 'sk-or-factice',
  OPENAI_API_KEY: 'sk-factice-openai',
  LLM_GUIDE_PROVIDER: 'openrouter',
  LLM_GUIDE_MODEL: 'modele/de-test',
  LLM_GUIDE_EXTRA_BODY: '{}',
  LLM_GUIDE_PRICE_INPUT_USD_PER_MTOK: '0.20',
  LLM_GUIDE_PRICE_OUTPUT_USD_PER_MTOK: '1.20',
  GUIDE_IP_HASH_SECRET: 'secret-de-test-assez-long',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
});
