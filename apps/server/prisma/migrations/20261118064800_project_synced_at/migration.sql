-- DropIndex
DROP INDEX "Project_ownerId_updatedAt_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Project_ownerId_syncedAt_idx" ON "Project"("ownerId", "syncedAt");
