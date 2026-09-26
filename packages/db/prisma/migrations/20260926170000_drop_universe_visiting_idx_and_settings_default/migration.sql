-- DropIndex
DROP INDEX "universes_visiting_id_idx";

-- AlterTable
ALTER TABLE "site_settings" ALTER COLUMN "updated_at" DROP DEFAULT;
