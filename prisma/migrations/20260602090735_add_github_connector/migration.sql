-- CreateTable
CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubItem" (
    "id" TEXT NOT NULL,
    "githubConnectionId" TEXT NOT NULL,
    "githubItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "state" TEXT,
    "author" TEXT,
    "url" TEXT,
    "labels" TEXT[],
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubConnection_workflowId_nodeId_key" ON "GitHubConnection"("workflowId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubItem_githubConnectionId_githubItemId_type_key" ON "GitHubItem"("githubConnectionId", "githubItemId", "type");

-- AddForeignKey
ALTER TABLE "GitHubItem" ADD CONSTRAINT "GitHubItem_githubConnectionId_fkey" FOREIGN KEY ("githubConnectionId") REFERENCES "GitHubConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
