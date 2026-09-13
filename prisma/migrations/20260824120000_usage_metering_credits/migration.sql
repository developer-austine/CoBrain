-- ============================================================================
-- Usage metering & credits.
--
-- Tables + RLS land together here, unlike the 20260814 scaling pair. That
-- migration had to split because it was retrofitting policies onto tables
-- already full of rows served by call sites that did not yet scope. These
-- tables are new and empty, and every reader goes through withTenant from the
-- first commit, so there is no window in which forcing RLS breaks a live path.
-- ============================================================================

-- --- UsageEvent: the append-only ledger ------------------------------------
CREATE TABLE "UsageEvent" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "actorUserId"    TEXT,
    "feature"        TEXT NOT NULL,
    "quantity"       DECIMAL(20,6) NOT NULL,
    "unit"           TEXT NOT NULL,
    "credits"        DECIMAL(20,6) NOT NULL,
    "costMicros"     BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata"       JSONB NOT NULL DEFAULT '{}',
    "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "UsageEvent"("idempotencyKey");
CREATE INDEX "UsageEvent_tenantId_occurredAt_idx" ON "UsageEvent"("tenantId", "occurredAt");
CREATE INDEX "UsageEvent_tenantId_feature_occurredAt_idx" ON "UsageEvent"("tenantId", "feature", "occurredAt");
CREATE INDEX "UsageEvent_tenantId_actorUserId_occurredAt_idx" ON "UsageEvent"("tenantId", "actorUserId", "occurredAt");

-- --- CreditLedger: grants, purchases, expiries ------------------------------
CREATE TABLE "CreditLedger" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "kind"           TEXT NOT NULL,
    "credits"        DECIMAL(20,6) NOT NULL,
    "periodStart"    TIMESTAMP(3),
    "periodEnd"      TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditLedger_idempotencyKey_key" ON "CreditLedger"("idempotencyKey");
CREATE INDEX "CreditLedger_tenantId_createdAt_idx" ON "CreditLedger"("tenantId", "createdAt");

-- --- TenantBilling: the only mutable table here -----------------------------
CREATE TABLE "TenantBilling" (
    "tenantId"        TEXT NOT NULL,
    "plan"            TEXT NOT NULL DEFAULT 'starter',
    "includedCredits" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "periodStart"     TIMESTAMP(3) NOT NULL,
    "periodEnd"       TIMESTAMP(3) NOT NULL,
    "hardCapCredits"  DECIMAL(20,6),
    "alertThresholds" INTEGER[] DEFAULT ARRAY[75, 90]::INTEGER[],
    "overageAllowed"  BOOLEAN NOT NULL DEFAULT true,
    "featureCaps"     JSONB NOT NULL DEFAULT '{}',
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBilling_pkey" PRIMARY KEY ("tenantId")
);

CREATE INDEX "TenantBilling_periodEnd_idx" ON "TenantBilling"("periodEnd");

-- --- UsageAlert: one row per threshold per period ---------------------------
CREATE TABLE "UsageAlert" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "threshold"      INTEGER NOT NULL,
    "period"         TEXT NOT NULL,
    "usedPct"        INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "notifiedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageAlert_idempotencyKey_key" ON "UsageAlert"("idempotencyKey");
CREATE INDEX "UsageAlert_tenantId_createdAt_idx" ON "UsageAlert"("tenantId", "createdAt");

-- --- MarginReport: internal, cross-tenant by design --------------------------
CREATE TABLE "MarginReport" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "weekStart"      TIMESTAMP(3) NOT NULL,
    "revenueMicros"  BIGINT NOT NULL,
    "costMicros"     BIGINT NOT NULL,
    "marginPct"      DOUBLE PRECISION,
    "topCostFeature" TEXT,
    "seats"          INTEGER NOT NULL DEFAULT 1,
    "costPerSeat"    BIGINT NOT NULL DEFAULT 0,
    "flagged"        BOOLEAN NOT NULL DEFAULT false,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarginReport_tenantId_weekStart_key" ON "MarginReport"("tenantId", "weekStart");
CREATE INDEX "MarginReport_weekStart_idx" ON "MarginReport"("weekStart");

-- ============================================================================
-- Row-Level Security.
--
-- Same shape as 20260814130000, but the discriminator column is "tenantId"
-- rather than "userId". current_setting(..., true) yields NULL when unset and
-- NULL = anything is never true, so an unscoped connection sees ZERO rows.
--
-- MarginReport is deliberately EXCLUDED: it is the internal report that
-- compares tenants against one another, and it is only ever read through
-- withoutTenantScope by operators. A tenant policy on it would make the one
-- query it exists to serve return nothing.
-- ============================================================================
DO $$
DECLARE
  t text;
  metered_tables text[] := ARRAY['UsageEvent', 'CreditLedger', 'TenantBilling', 'UsageAlert'];
BEGIN
  FOREACH t IN ARRAY metered_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true))
       WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;

-- ============================================================================
-- LAW 1, enforced by the database rather than by reviewer attention.
--
-- An RLS policy cannot express "no UPDATE, no DELETE, ever, for anyone", so the
-- two ledgers get triggers instead. Any code path that tries to rewrite history
-- fails loudly at the moment it tries, which is the only time the mistake is
-- still cheap to fix. TenantBilling and UsageAlert are excluded: policy is
-- meant to change, and an alert has to record when it was delivered.
-- ============================================================================
CREATE OR REPLACE FUNCTION metering_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only (metering LAW 1): % rejected. Corrections are new rows with negative credits.',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usage_event_append_only
  BEFORE UPDATE OR DELETE ON "UsageEvent"
  FOR EACH ROW EXECUTE FUNCTION metering_reject_mutation();

CREATE TRIGGER credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON "CreditLedger"
  FOR EACH ROW EXECUTE FUNCTION metering_reject_mutation();
