-- CreateTable
CREATE TABLE "ConnectorSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "syncingSince" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastItemCount" INTEGER,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorSyncState_userId_idx" ON "ConnectorSyncState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorSyncState_source_connectionId_key" ON "ConnectorSyncState"("source", "connectionId");
