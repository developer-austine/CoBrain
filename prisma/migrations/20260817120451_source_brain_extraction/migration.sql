-- AlterTable
ALTER TABLE "SourceFile" ADD COLUMN     "brainAt" TIMESTAMP(3),
ADD COLUMN     "brainBlocks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "brainError" TEXT,
ADD COLUMN     "brainStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "SourceFile_userId_brainStatus_idx" ON "SourceFile"("userId", "brainStatus");
