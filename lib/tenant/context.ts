import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * The tenant currently being served, and the database client bound to it.
 *
 * Ambient rather than threaded through every signature. There are ~650 Prisma
 * calls in this codebase; passing a scoped client to each is ~650 chances to
 * pass the wrong one, and the failure would be silent. AsyncLocalStorage makes
 * the binding a property of the request instead of of the call site, so a query
 * cannot accidentally run unscoped.
 *
 * The store follows async continuations, so it survives awaits without leaking
 * between concurrent requests the way a module-level variable would.
 */

export type TenantScope = {
  tenantId: string;
  /** The transaction client whose connection carries `app.tenant_id`. */
  client: PrismaClient;
};

const storage = new AsyncLocalStorage<TenantScope>();

export function runInTenantScope<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The active scope, or undefined outside a tenant-scoped request. */
export function currentScope(): TenantScope | undefined {
  return storage.getStore();
}

export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** The tenant-bound client, or undefined when no scope is active. */
export function currentTenantClient(): PrismaClient | undefined {
  return storage.getStore()?.client;
}
