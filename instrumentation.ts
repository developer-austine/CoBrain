/**
 * Next.js boot hook. Runs once, server-side, before the app serves traffic.
 *
 * We validate the production configuration here so an unsafe or incomplete
 * deploy fails loudly at startup rather than degrading silently under load.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionConfig } = await import("@/lib/config/env");
  assertProductionConfig();
}
