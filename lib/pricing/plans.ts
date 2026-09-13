/**
 * Pricing catalog + billing math. Pure module — no React — so the data can be
 * reused by marketing pages, the billing screen, and unit tests.
 */

export type BillingCycle = "monthly" | "yearly";

export type PricingPlan = {
  name: string;
  desc: string;
  /** Monthly list price in USD. 0 = free, null = custom/contact-sales. */
  monthlyPrice: number;
  features: string[];
  ctaText: string;
  isPopular?: boolean;
};

export const YEARLY_DISCOUNT = 0.25;

/** Displayed per-month price for the chosen cycle (yearly = 25% off, floored). */
export function priceForCycle(monthlyPrice: number, cycle: BillingCycle): number {
  if (cycle !== "yearly") return monthlyPrice;
  return Math.floor(monthlyPrice * (1 - YEARLY_DISCOUNT));
}

export const DEFAULT_PLANS: PricingPlan[] = [
  {
    name: "Free",
    desc: "Explore the platform with no commitment. Perfect for personal side projects.",
    monthlyPrice: 0,
    features: ["1 project", "1 GB storage", "Basic dashboard", "Community support", "500 API calls/mo"],
    ctaText: "Get Started",
  },
  {
    name: "Starter",
    desc: "For solo builders ready to ship more with extra room and core tools.",
    monthlyPrice: 19,
    features: ["Up to 5 projects", "10 GB storage", "Analytics & reporting", "Email support", "5,000 API calls/mo"],
    ctaText: "Start free trial",
  },
  {
    name: "Pro",
    desc: "For growing teams that need collaboration, automation, and more power.",
    monthlyPrice: 49,
    features: [
      "Unlimited projects",
      "100 GB storage",
      "Advanced analytics",
      "Team seats (up to 15)",
      "Priority support (12h SLA)",
      "50,000 API calls/mo",
      "Workflow automation",
    ],
    ctaText: "Start free trial",
    isPopular: true,
  },
  {
    name: "Scale",
    desc: "Built for orgs that demand enterprise-grade reliability at any size.",
    monthlyPrice: 129,
    features: [
      "Everything in Pro",
      "1 TB storage",
      "Unlimited team seats",
      "Dedicated account manager",
      "Unlimited API calls",
      "SSO, SAML & audit logs",
      "Custom SLA & onboarding",
    ],
    ctaText: "Contact sales",
  },
];
