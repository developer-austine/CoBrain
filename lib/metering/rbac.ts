import "server-only";

/**
 * Who may see and change billing.
 *
 * This codebase has no role model yet: a tenant id IS a Better Auth user id
 * (see the RLS policies in 20260814130000), so today every tenant has exactly
 * one member and that member is its admin.
 *
 * The check is written as a real function anyway, and every admin-only path
 * calls it server-side, because the two things it guards are genuinely
 * sensitive the moment tenants have more than one member:
 *   - per-person usage (Section 8e) is employee monitoring data
 *   - caps and thresholds decide what the workspace is allowed to spend
 * Hiding those in the UI alone would mean the API is open the day seats ship.
 * When a role model arrives, this is the one function that changes.
 */
export async function isTenantAdmin(
  tenantId: string,
  userId: string | null
): Promise<boolean> {
  if (!userId) return false;
  return tenantId === userId;
}

/** Throws with a 403-shaped message. For routes that must not degrade quietly. */
export async function assertTenantAdmin(
  tenantId: string,
  userId: string | null
): Promise<void> {
  if (!(await isTenantAdmin(tenantId, userId))) {
    throw new AdminRequiredError();
  }
}

export class AdminRequiredError extends Error {
  constructor() {
    super("This action requires a workspace admin");
    this.name = "AdminRequiredError";
  }
}
