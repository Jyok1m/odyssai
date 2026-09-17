-- CreateEnum
CREATE TYPE "guide_source" AS ENUM ('faq', 'llm', 'off_topic', 'degraded', 'error');

-- CreateTable
CREATE TABLE "guide_questions" (
    "id" UUID NOT NULL,
    "locale" "locale" NOT NULL,
    "question" TEXT NOT NULL,
    "normalized_hash" TEXT NOT NULL,
    "source" "guide_source" NOT NULL,
    "faq_entry_id" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "traced" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT,
    "prompt_version" TEXT NOT NULL,
    "corpus_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guide_questions_created_at_idx" ON "guide_questions"("created_at");

-- CreateIndex
CREATE INDEX "guide_questions_normalized_hash_idx" ON "guide_questions"("normalized_hash");
