-- AlterTable
ALTER TABLE "GitHubConnection" ADD COLUMN     "codeSyncedAt" TIMESTAMP(3),
ADD COLUMN     "codeTreeSha" TEXT,
ADD COLUMN     "commitsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "defaultBranch" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastCommitSha" TEXT,
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "repoId" TEXT;

-- AlterTable
ALTER TABLE "GitHubItem" ADD COLUMN     "additions" INTEGER,
ADD COLUMN     "changedFiles" INTEGER,
ADD COLUMN     "deletions" INTEGER,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "path" TEXT,
ADD COLUMN     "sha" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- CreateIndex
CREATE INDEX "GitHubItem_githubConnectionId_type_idx" ON "GitHubItem"("githubConnectionId", "type");

-- CreateIndex
CREATE INDEX "GitHubItem_githubConnectionId_author_idx" ON "GitHubItem"("githubConnectionId", "author");
