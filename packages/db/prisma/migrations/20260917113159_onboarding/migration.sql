-- CreateEnum
CREATE TYPE "onboarding_step" AS ENUM ('inspiration', 'character', 'generating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "inspiration_mode" AS ENUM ('works', 'own');

-- CreateEnum
CREATE TYPE "conversation_channel" AS ENUM ('character_creation', 'game_turn');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "generation_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "generation_step" AS ENUM ('abstraction', 'charter', 'lore', 'factions', 'politics', 'characters', 'affinities', 'validation');

-- CreateTable
CREATE TABLE "universes" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "step" "onboarding_step" NOT NULL DEFAULT 'inspiration',
    "mode" "inspiration_mode",
    "works" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "own_description" TEXT,
    "themes" JSONB,
    "charter" JSONB,
    "bible" JSONB,
    "name" VARCHAR(80),
    "accent_hue" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "universes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "gender" VARCHAR(40),
    "age" INTEGER,
    "personality" JSONB,
    "attributes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "channel" "conversation_channel" NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "status" "generation_status" NOT NULL DEFAULT 'queued',
    "step" "generation_step",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "trace_id" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "universes_owner_id_key" ON "universes"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_universe_id_key" ON "characters"("universe_id");

-- CreateIndex
CREATE INDEX "conversation_messages_universe_id_channel_created_at_idx" ON "conversation_messages"("universe_id", "channel", "created_at");

-- CreateIndex
CREATE INDEX "generation_jobs_universe_id_created_at_idx" ON "generation_jobs"("universe_id", "created_at");

-- AddForeignKey
ALTER TABLE "universes" ADD CONSTRAINT "universes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

