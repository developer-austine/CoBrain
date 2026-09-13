-- ============================================================================
-- Scaling module C2 — ENABLE Row-Level Security.
--
-- SEPARATE MIGRATION ON PURPOSE. Once applied, every connection that has not
-- set `app.tenant_id` sees ZERO rows on these tables — that is the point, and
-- it is also why it cannot land in the same step as the columns it depends on.
--
-- Apply only after every call site goes through a tenant-scoped client:
--   TypeScript : lib/tenant/prisma.ts  -> withTenant(userId, fn)
--   Python     : backend/python/db/tenant.py -> with_tenant(conn, tenant_id)
--
-- Verify with: pytest backend/security/tests/test_rls.py
-- ============================================================================

-- --- Enable + FORCE RLS, one policy per tenant-scoped table ----------------
-- current_setting(..., true) returns NULL when unset, and NULL = anything is
-- never true, so a connection that forgot to set the tenant sees ZERO rows
-- rather than everything.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'SourceFile', 'Email', 'NotionPage', 'GitHubItem', 'CustomDocument',
    'BrainBlock', 'Workflow', 'WorkflowLink', 'AgentConfig', 'PromptEvent',
    'ChatConversation', 'ChatMessage', 'CompanyProfile', 'ConnectorSyncState',
    'GitHubConnection', 'GmailConnection', 'NotionConnection', 'CustomConnection',
    'CustomSyncCursor', 'NotionSyncCursor',
    'TenantKey', 'DriftReport', 'NormStats', 'AuditEvent'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("userId" = current_setting(''app.tenant_id'', true))
       WITH CHECK ("userId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
