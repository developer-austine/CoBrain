-- CreateTable
CREATE TABLE "NotionConnection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "workspaceName" TEXT,
    "workspaceId" TEXT,
    "botId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotionPage" (
    "id" TEXT NOT NULL,
    "notionConnectionId" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "notionEditedTime" TEXT NOT NULL,
    "title" TEXT,
    "plainText" TEXT,
    "snippet" TEXT,
    "createdByName" TEXT,
    "parentType" TEXT,
    "url" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotionPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotionSyncCursor" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "subSource" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotionConnection_workflowId_nodeId_key" ON "NotionConnection"("workflowId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NotionPage_notionConnectionId_notionPageId_key" ON "NotionPage"("notionConnectionId", "notionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotionSyncCursor_connectionId_subSource_key" ON "NotionSyncCursor"("connectionId", "subSource");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_gmailConnectionId_fkey" FOREIGN KEY ("gmailConnectionId") REFERENCES "GmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionPage" ADD CONSTRAINT "NotionPage_notionConnectionId_fkey" FOREIGN KEY ("notionConnectionId") REFERENCES "NotionConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionSyncCursor" ADD CONSTRAINT "NotionSyncCursor_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "NotionConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
