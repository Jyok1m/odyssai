-- Ce qu'un personnage emporte en franchissant une faille.
--
-- Le nom, le caractere et le socle chiffre traversent ; le metier, les
-- talents, les objets et l'etat restent au monde qu'on quitte.

CREATE TYPE "arrival" AS ENUM ('natif', 'voyageur', 'echo');

CREATE TABLE "essences" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "gender" VARCHAR(40) NOT NULL,
  "age" INTEGER NOT NULL,
  "personality" JSONB NOT NULL,
  "attributes" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "essences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "essences_owner_id_created_at_idx" ON "essences" ("owner_id", "created_at");

ALTER TABLE "essences"
  ADD CONSTRAINT "essences_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "characters" ADD COLUMN "essence_id" UUID;
ALTER TABLE "characters" ADD COLUMN "arrival" "arrival" NOT NULL DEFAULT 'natif';

ALTER TABLE "characters"
  ADD CONSTRAINT "characters_essence_id_fkey"
  FOREIGN KEY ("essence_id") REFERENCES "essences" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Chaque personnage deja complet devient l'essence dont il est la premiere
-- incarnation. Sans ce report, « reprendre un personnage » ne proposerait
-- rien tant qu'on n'en aurait pas cree un nouveau, et les parties en cours
-- seraient les seules a ne jamais pouvoir voyager.
--
-- Les fiches incompletes sont laissees de cote : une essence sans nom ni socle
-- ne s'incarne nulle part, et le parcours en creera une a la validation de la
-- fiche.
--
-- L'essence reprend l'identifiant de son incarnation d'origine : deux
-- personnages d'un meme joueur peuvent porter le meme nom, et rapprocher les
-- deux tables par (proprietaire, nom) les aurait confondus. Deux tables qui
-- partagent une valeur d'identifiant est une trace de migration, pas une
-- regle : les essences creees ensuite ont la leur.
INSERT INTO "essences" ("id", "owner_id", "name", "gender", "age", "personality", "attributes", "updated_at")
SELECT c."id", u."owner_id", c."name", c."gender", c."age", c."personality", c."attributes", CURRENT_TIMESTAMP
FROM "characters" c
JOIN "universes" u ON u."id" = c."universe_id"
WHERE u."owner_id" IS NOT NULL
  AND c."name" IS NOT NULL
  AND c."gender" IS NOT NULL
  AND c."age" IS NOT NULL
  AND c."personality" IS NOT NULL
  AND c."attributes" IS NOT NULL;

UPDATE "characters" c
SET "essence_id" = c."id"
FROM "essences" e
WHERE e."id" = c."id";
