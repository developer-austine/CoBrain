-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggers" TEXT[],
    "action" TEXT NOT NULL,
    "writeTarget" TEXT NOT NULL,
    "persistence" TEXT NOT NULL DEFAULT 'permanent',
    "extraFlags" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "sourceRefs" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL DEFAULT 'ai',
    "status" TEXT NOT NULL DEFAULT 'active',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "humanVerified" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "extractedChars" INTEGER,
    "errorMessage" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'unified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "references" JSONB,
    "intent" TEXT NOT NULL,
    "model" TEXT,
    "inputMethod" TEXT NOT NULL DEFAULT 'typed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConfig_userId_enabled_idx" ON "AgentConfig"("userId", "enabled");

-- CreateIndex
CREATE INDEX "BrainBlock_userId_status_type_idx" ON "BrainBlock"("userId", "status", "type");

-- CreateIndex
CREATE INDEX "BrainBlock_userId_pinned_idx" ON "BrainBlock"("userId", "pinned");

-- CreateIndex
CREATE INDEX "SourceFile_userId_status_idx" ON "SourceFile"("userId", "status");

-- CreateIndex
CREATE INDEX "PromptEvent_userId_createdAt_idx" ON "PromptEvent"("userId", "createdAt");
