-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "turns" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "die" INTEGER NOT NULL,
    "band" VARCHAR(20) NOT NULL,
    "used_die" BOOLEAN NOT NULL DEFAULT false,
    "kind" VARCHAR(16) NOT NULL,
    "learned" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canon_facts" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "subject" VARCHAR(80) NOT NULL,
    "statement" VARCHAR(400) NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canon_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "turns_universe_id_seq_key" ON "turns"("universe_id", "seq");

-- CreateIndex
CREATE INDEX "canon_facts_universe_id_created_at_idx" ON "canon_facts"("universe_id", "created_at");

-- Renumerotation des conversations existantes avant de poser l'unicite.
-- Toutes les lignes heritent de seq = 0 par le DEFAULT, ce qui violerait
-- l'index des la premiere paire. L'ordre retenu est celui de created_at, le
-- seul dont on dispose, avec l'id pour departager une collision a la
-- milliseconde : c'est precisement l'ambiguite que cette colonne supprime
-- pour la suite.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY universe_id, channel
           ORDER BY created_at, id
         ) - 1 AS rank
  FROM "conversation_messages"
)
UPDATE "conversation_messages" AS m
SET seq = ranked.rank
FROM ranked
WHERE m.id = ranked.id;

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_universe_id_channel_seq_key" ON "conversation_messages"("universe_id", "channel", "seq");

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canon_facts" ADD CONSTRAINT "canon_facts_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

