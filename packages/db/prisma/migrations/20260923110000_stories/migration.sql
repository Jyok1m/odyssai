-- Plusieurs histoires par joueur, sur la meme reserve de credits.

-- L'unicite du proprietaire tombe, un index ordinaire la remplace.
DROP INDEX "universes_owner_id_key";
CREATE INDEX "universes_owner_id_idx" ON "universes"("owner_id");

-- L'histoire ouverte. SetNull : supprimer l'histoire ouverte ramene le joueur
-- a une histoire neuve, les autres restent a portee.
ALTER TABLE "users" ADD COLUMN "current_universe_id" UUID;
ALTER TABLE "users" ADD CONSTRAINT "users_current_universe_id_fkey"
  FOREIGN KEY ("current_universe_id") REFERENCES "universes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Chaque joueur existant ouvre la seule histoire qu'il avait.
UPDATE "users" u
SET "current_universe_id" = un."id"
FROM "universes" un
WHERE un."owner_id" = u."id";
