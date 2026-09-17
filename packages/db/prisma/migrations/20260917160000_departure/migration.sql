-- Les quatre DropTable ci-dessous ne sont pas une perte : ce sont les tables
-- du checkpointer LangGraph, restees dans `public` avant qu'il ne prenne son
-- propre schema. Prisma ne les connait pas, donc chaque `migrate diff` les
-- voyait comme des intruses et proposait de les supprimer, ce qui aurait
-- efface l'etat de reprise des generations en cours. Le worker les recree
-- desormais dans le schema `langgraph`, hors de portee de Prisma, et celles-ci
-- sont vides. `IF EXISTS` parce qu'une base neuve, elle, ne les a jamais
-- portees : sans lui la suite des migrations n'etait plus rejouable depuis
-- zero, et le premier deploiement sur une base en retard echouait ici.

-- DropForeignKey
ALTER TABLE "characters" DROP CONSTRAINT "characters_universe_id_fkey";

-- DropForeignKey
ALTER TABLE "universes" DROP CONSTRAINT "universes_owner_id_fkey";

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "died_at" TIMESTAMPTZ(3),
ALTER COLUMN "universe_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "universes" ALTER COLUMN "owner_id" DROP NOT NULL;

-- DropTable
DROP TABLE IF EXISTS "checkpoint_blobs";

-- DropTable
DROP TABLE IF EXISTS "checkpoint_migrations";

-- DropTable
DROP TABLE IF EXISTS "checkpoint_writes";

-- DropTable
DROP TABLE IF EXISTS "checkpoints";

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "character_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounters_universe_id_visitor_id_idx" ON "encounters"("universe_id", "visitor_id");

-- CreateIndex
CREATE INDEX "encounters_character_id_visitor_id_idx" ON "encounters"("character_id", "visitor_id");

-- AddForeignKey
ALTER TABLE "universes" ADD CONSTRAINT "universes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

