-- CreateTable
CREATE TABLE "llm_usage" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "universe_id" UUID,
    "kind" VARCHAR(24) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "reasoning_tokens" INTEGER,
    "cost_usd" DECIMAL(12,8),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usage_user_id_created_at_idx" ON "llm_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_usage_kind_created_at_idx" ON "llm_usage"("kind", "created_at");

-- AddForeignKey
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

