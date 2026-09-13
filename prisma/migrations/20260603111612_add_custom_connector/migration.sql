-- CreateTable
CREATE TABLE "CustomConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDocument" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "queuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CustomDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomSyncCursor" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomConnection_clientId_key" ON "CustomConnection"("clientId");

-- CreateIndex
CREATE INDEX "CustomConnection_userId_idx" ON "CustomConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomConnection_workflowId_nodeId_key" ON "CustomConnection"("workflowId", "nodeId");

-- CreateIndex
CREATE INDEX "CustomDocument_status_idx" ON "CustomDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDocument_connectionId_externalId_key" ON "CustomDocument"("connectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomSyncCursor_connectionId_key" ON "CustomSyncCursor"("connectionId");

-- AddForeignKey
ALTER TABLE "CustomDocument" ADD CONSTRAINT "CustomDocument_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CustomConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomSyncCursor" ADD CONSTRAINT "CustomSyncCursor_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CustomConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
