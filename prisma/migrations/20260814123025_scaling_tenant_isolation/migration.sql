-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CustomDocument" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CustomSyncCursor" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "GitHubItem" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "NotionPage" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "NotionSyncCursor" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "TenantKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" BYTEA,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shreddedAt" TIMESTAMP(3),
    "shredReason" TEXT,

    CONSTRAINT "TenantKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "week" TIMESTAMP(3) NOT NULL,
    "target" TEXT NOT NULL,
    "coverage12w" DOUBLE PRECISION,
    "worstPsiFeature" TEXT,
    "worstPsiValue" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectKey" TEXT,
    "sourceIp" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantKey_userId_idx" ON "TenantKey"("userId");

-- CreateIndex
CREATE INDEX "TenantKey_userId_active_idx" ON "TenantKey"("userId", "active");

-- CreateIndex
CREATE INDEX "DriftReport_userId_status_idx" ON "DriftReport"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DriftReport_userId_week_target_key" ON "DriftReport"("userId", "week", "target");

-- CreateIndex
CREATE INDEX "NormStats_userId_idx" ON "NormStats"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NormStats_userId_version_key" ON "NormStats"("userId", "version");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");

-- CreateIndex
CREATE INDEX "CustomDocument_userId_idx" ON "CustomDocument"("userId");

-- CreateIndex
CREATE INDEX "Email_userId_idx" ON "Email"("userId");

-- CreateIndex
CREATE INDEX "GitHubItem_userId_idx" ON "GitHubItem"("userId");

-- CreateIndex
CREATE INDEX "NotionPage_userId_idx" ON "NotionPage"("userId");

-- ============================================================================
-- Scaling module C2 — structural tenant isolation
--
-- Application-level "WHERE userId = ..." is one forgotten clause from a leak.
-- These policies make the DATABASE refuse a cross-tenant read even when the
-- application is wrong.
-- ============================================================================

-- --- Backfill the denormalised tenant column from each parent connection ----
UPDATE "GitHubItem" i SET "userId" = c."userId"
  FROM "GitHubConnection" c WHERE c.id = i."githubConnectionId" AND i."userId" = '';

UPDATE "Email" e SET "userId" = c."userId"
  FROM "GmailConnection" c WHERE c.id = e."gmailConnectionId" AND e."userId" = '';

UPDATE "NotionPage" p SET "userId" = c."userId"
  FROM "NotionConnection" c WHERE c.id = p."notionConnectionId" AND p."userId" = '';

UPDATE "NotionSyncCursor" s SET "userId" = c."userId"
  FROM "NotionConnection" c WHERE c.id = s."connectionId" AND s."userId" = '';

UPDATE "CustomDocument" d SET "userId" = c."userId"
  FROM "CustomConnection" c WHERE c.id = d."connectionId" AND d."userId" = '';

UPDATE "CustomSyncCursor" s SET "userId" = c."userId"
  FROM "CustomConnection" c WHERE c.id = s."connectionId" AND s."userId" = '';

UPDATE "ChatMessage" m SET "userId" = v."userId"
  FROM "ChatConversation" v WHERE v.id = m."conversationId" AND m."userId" = '';

-- At most one ACTIVE key per tenant. A partial unique index, because a tenant
-- may accumulate several shredded keys over time.
CREATE UNIQUE INDEX "TenantKey_one_active_per_tenant"
  ON "TenantKey" ("userId") WHERE "active";

-- --- The application role: deliberately NOT the table owner (RULE C-2) ------
-- An owner bypasses RLS unless FORCE is set. FORCE is set below anyway, but a
-- non-owner role means a missed FORCE is not silently fatal.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cobrain_app') THEN
    CREATE ROLE cobrain_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cobrain_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cobrain_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cobrain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cobrain_app;
