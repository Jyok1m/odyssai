-- Les jetons d'entree servis depuis le cache du fournisseur : le seul temoin
-- qu'un cache de prompt sert vraiment.
ALTER TABLE "llm_usage" ADD COLUMN "cached_tokens" INTEGER;
