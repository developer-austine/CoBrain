-- CreateTable
CREATE TABLE "SlackConnection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "userToken" TEXT,
    "teamId" TEXT,
    "teamName" TEXT,
    "botUserId" TEXT,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackMessage" (
    "id" TEXT NOT NULL,
    "slackConnectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "messageTs" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "threadTs" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "text" TEXT,
    "permalink" TEXT,
    "postedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SlackMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "email" TEXT,
    "startPageToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFile" (
    "id" TEXT NOT NULL,
    "driveConnectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "fileId" TEXT NOT NULL,
    "name" TEXT,
    "mimeType" TEXT,
    "version" TEXT,
    "webViewLink" TEXT,
    "ownerName" TEXT,
    "modifiedTime" TIMESTAMP(3),
    "sizeBytes" INTEGER,
    "plainText" TEXT,
    "snippet" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlackConnection_userId_idx" ON "SlackConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackConnection_workflowId_nodeId_key" ON "SlackConnection"("workflowId", "nodeId");

-- CreateIndex
CREATE INDEX "SlackMessage_status_idx" ON "SlackMessage"("status");

-- CreateIndex
CREATE INDEX "SlackMessage_userId_idx" ON "SlackMessage"("userId");

-- CreateIndex
CREATE INDEX "SlackMessage_slackConnectionId_channelId_idx" ON "SlackMessage"("slackConnectionId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackMessage_slackConnectionId_channelId_messageTs_key" ON "SlackMessage"("slackConnectionId", "channelId", "messageTs");

-- CreateIndex
CREATE INDEX "DriveConnection_userId_idx" ON "DriveConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_workflowId_nodeId_key" ON "DriveConnection"("workflowId", "nodeId");

-- CreateIndex
CREATE INDEX "DriveFile_status_idx" ON "DriveFile"("status");

-- CreateIndex
CREATE INDEX "DriveFile_userId_idx" ON "DriveFile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFile_driveConnectionId_fileId_key" ON "DriveFile"("driveConnectionId", "fileId");

-- AddForeignKey
ALTER TABLE "SlackMessage" ADD CONSTRAINT "SlackMessage_slackConnectionId_fkey" FOREIGN KEY ("slackConnectionId") REFERENCES "SlackConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_driveConnectionId_fkey" FOREIGN KEY ("driveConnectionId") REFERENCES "DriveConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
