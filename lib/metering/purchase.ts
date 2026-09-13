import "server-only";
import prisma from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { adjustCachedBalance } from "./balance";
import { currentPeriod } from "./period";

/**
 * Credit top-ups.
 *
 * Split deliberately into two halves that know nothing about each other:
 *
 *   startCheckout()      creates a payment session with whatever provider is
 *                        configured. Knows about money, not about credits.
 *   fulfilCreditPurchase() writes the CreditLedger row. Knows about credits,
 *                        not about who took the payment.
 *
 * The seam is what makes fulfilment testable and what makes swapping providers
 * a small change. It is also the only shape in which the idempotency guarantee
 * is honest: the provider's event id becomes the ledger's idempotency key, so a
 * webhook redelivered five times — which every payment provider will do — grants
 * credits exactly once.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────
 * There is no Stripe dependency and no payment configuration in this repo, so
 * startCheckout() reports that purchasing is unavailable rather than pretending
 * to take money. Fulfilment below is complete and real: wiring a provider means
 * implementing startCheckout and calling fulfilCreditPurchase from its webhook,
 * with nothing in this file's guarantees left to re-derive.
 */

export type CheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: "not_configured"; message: string };

/** Credit bundles offered at top-up. Priced in whole USD. */
export const CREDIT_PACKS = [
  { credits: 500, priceUsd: 25 },
  { credits: 2_000, priceUsd: 90 },
  { credits: 10_000, priceUsd: 400 },
] as const;

export function isValidPack(credits: number): boolean {
  return CREDIT_PACKS.some((pack) => pack.credits === credits);
}

/**
 * Begin a hosted checkout for `credits`.
 *
 * Returns a structured refusal rather than throwing when no provider is
 * configured: "you cannot buy credits here yet" is an ordinary state of this
 * deployment, and the page should say so plainly instead of showing an error.
 */
export async function startCheckout(_args: {
  tenantId: string;
  actorUserId: string;
  credits: number;
}): Promise<CheckoutResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Credit purchases aren't set up for this workspace yet. Contact support to add credits.",
    };
  }

  // A provider is configured but this build has no client for it. Failing
  // loudly beats silently returning a dead URL that looks like a checkout.
  throw new Error(
    "STRIPE_SECRET_KEY is set but no payment client is wired. Implement startCheckout() before enabling purchases."
  );
}

/**
 * Grant purchased credits. Idempotent on the provider's event id.
 *
 * Call this from the payment webhook, passing the event id verbatim. Do not
 * generate a key here: the whole point is that the provider's own identifier
 * for the payment is what deduplicates a redelivery, and a key minted locally
 * would be different on every attempt.
 */
export async function fulfilCreditPurchase(args: {
  tenantId: string;
  credits: number;
  /** The payment provider's event id. Verbatim. */
  providerEventId: string;
  note?: string;
}): Promise<{ granted: boolean }> {
  if (!Number.isFinite(args.credits) || args.credits <= 0) {
    throw new Error(`Refusing to grant a non-positive credit purchase: ${args.credits}`);
  }

  const period = await currentPeriod(args.tenantId);

  try {
    await prisma.creditLedger.create({
      data: {
        tenantId: args.tenantId,
        kind: "purchase",
        credits: new Prisma.Decimal(args.credits),
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        idempotencyKey: `purchase:${args.providerEventId}`,
        note: args.note ?? `Credit top-up (${args.credits} credits)`,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Redelivered webhook. The credits are already in the ledger.
      return { granted: false };
    }
    throw err;
  }

  await adjustCachedBalance(args.tenantId, args.credits).catch((err) => {
    // The ledger has the grant; the cache will be rebuilt tonight. Never fail a
    // fulfilment for a cache write — the customer has already paid.
    console.warn(`[metering] balance cache not updated after purchase:`, err);
  });

  return { granted: true };
}
