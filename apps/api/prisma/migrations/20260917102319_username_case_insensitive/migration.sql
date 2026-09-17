-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username_folded" VARCHAR(32);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_folded_key" ON "users"("username_folded");
