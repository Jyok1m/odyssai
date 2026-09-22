/*
  Pose l'environnement des tests unitaires. Aucun test ne doit joindre un vrai
  fournisseur ni envoyer de trace : le tracing est force a off, et les cles
  sont factices meme si le .env racine en contient de vraies.
*/
Object.assign(process.env, {
  NODE_ENV: 'test',
  LANGSMITH_TRACING: 'false',
  LANGSMITH_API_KEY: 'ls-factice',
  OPENAI_API_KEY: 'sk-factice-openai',
  OPENROUTER_API_KEY: 'sk-or-factice',
});
