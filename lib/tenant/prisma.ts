import "server-only";
import { basePrisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { currentScope, runInTenantScope } from "@/lib/tenant/context";

/**
 * Tenant-scoped database access (Scaling module C2).
 *
 * Row-Level Security is enabled and FORCED on every tenant-scoped table, so a
 * connection that has not set `app.tenant_id` sees zero rows. That is the point
 * — a forgotten `where: { userId }` becomes an empty result instead of another
 * customer's data.
 *
 * The setting is applied INSIDE an interactive transaction with `is_local =
 * true`. Both halves matter: the transaction pins one connection for the whole
 * callback, and the local flag makes the setting die with it, so a pooled
 * connection cannot carry one tenant's context into the next request.
 */

const TENANT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** How long a scoped handler may hold its connection. */
const TRANSACTION_TIMEOUT_MS = 15_000;
const MAX_WAIT_MS = 5_000;

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

/**
 * Run `fn` with the database bound to one tenant.
 *
 * Every query inside — including those in functions called indirectly — sees
 * only that tenant's rows, enforced by Postgres rather than by each query being
 * written correctly.
 */
export async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  if (!TENANT_ID.test(tenantId ?? "")) {
    throw new TenantContextError(`Invalid tenant id: ${String(tenantId)}`);
  }

  const active = currentScope();
  if (active) {
    // Reentrant call. Postgres has no nested transactions, and re-entering
    // would deadlock on the pool; reuse the scope instead.
    if (active.tenantId !== tenantId) {
      throw new TenantContextError(
        `Cannot switch tenant inside an open scope (${active.tenantId} -> ${tenantId})`
      );
    }
    return fn();
  }

  return basePrisma.$transaction(
    async (tx) => {
      // Parameterised, never interpolated: a tenant id reaching SQL as text is
      // exactly the injection this boundary exists to prevent.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return runInTenantScope({ tenantId, client: tx as unknown as PrismaClient }, fn);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: MAX_WAIT_MS }
  );
}

/**
 * Escape hatch for genuinely fleet-wide work — model training, the drift
 * monitor, the scheduled connector sweep.
 *
 * Named to be conspicuous in review and in a grep, and it requires a stated
 * reason so the log says why the boundary was crossed. It does NOT disable
 * RLS: it runs with no tenant context, so under the application role it still
 * sees nothing. Crossing the boundary for real is a deployment decision — a
 * role permitted to — not something code can grant itself.
 */
export async function withoutTenantScope<T>(
  reason: string,
  fn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  if (!reason?.trim()) {
    throw new TenantContextError("Cross-tenant access requires a stated reason");
  }
  console.warn(`[tenant] cross-tenant access: ${reason}`);
  return fn(basePrisma);
}

/**
 * Long-running work that must not hold a transaction open.
 *
 * A connector sync spends minutes on external HTTP, and holding a pooled
 * connection for that would exhaust the pool and blow the statement timeout.
 * These jobs own their tenant scoping through explicit `where` clauses and run
 * unscoped; the name makes that an assertion rather than an oversight.
 */
export async function withLongRunningTenantJob<T>(
  tenantId: string,
  reason: string,
  fn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  if (!TENANT_ID.test(tenantId ?? "")) {
    throw new TenantContextError(`Invalid tenant id: ${String(tenantId)}`);
  }
  if (!reason?.trim()) {
    throw new TenantContextError("A long-running job must state why it cannot be scoped");
  }
  return fn(basePrisma);
}
