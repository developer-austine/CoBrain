/** Shared onboarding vocabulary — used by the wizard UI and the server action. */

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

/**
 * Industry, used purely to tailor presentation.
 *
 * The forecasting model does not change per industry and is not retrained on
 * anything collected here. Its features are already domain-neutral —
 * `median_review_delay` is a code review at a software company and a chart
 * sign-off at a clinic; the same number wants a different name. This field is
 * what lets the UI pick that name (and, later, the matching artwork).
 *
 * Keys are stable slugs and must never be renamed — they are persisted on the
 * profile and will key the label packs. Labels are free to change.
 */
export const INDUSTRIES = [
  { key: "technology",     label: "Technology & Software" },
  { key: "healthcare",     label: "Healthcare & Medical" },
  { key: "finance",        label: "Financial Services" },
  { key: "legal",          label: "Legal" },
  { key: "education",      label: "Education" },
  { key: "manufacturing",  label: "Manufacturing & Industrial" },
  { key: "retail",         label: "Retail & E-commerce" },
  { key: "media",          label: "Media & Marketing" },
  { key: "consulting",     label: "Professional Services & Consulting" },
  { key: "construction",   label: "Construction & Real Estate" },
  { key: "logistics",      label: "Logistics & Transport" },
  { key: "nonprofit",      label: "Non-profit & NGO" },
  { key: "government",     label: "Government & Public Sector" },
  { key: "other",          label: "Other" },
] as const;

export type IndustryKey = (typeof INDUSTRIES)[number]["key"];

export const INDUSTRY_KEYS = INDUSTRIES.map((i) => i.key) as readonly string[];

export function industryLabel(key: string | null | undefined): string | null {
  return INDUSTRIES.find((i) => i.key === key)?.label ?? null;
}

/** Connector choices offered during onboarding (key → display name). */
export const SOURCE_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: "gmail",      label: "Gmail",      description: "Emails & threads" },
  { key: "slack",      label: "Slack",      description: "Messages & channels" },
  { key: "notion",     label: "Notion",     description: "Pages & databases" },
  { key: "drive",      label: "Google Drive", description: "Docs & sheets" },
  { key: "github",     label: "GitHub",     description: "Issues & PRs" },
  { key: "jira",       label: "Jira",       description: "Tickets & sprints" },
  { key: "linear",     label: "Linear",     description: "Issues & projects" },
  { key: "confluence", label: "Confluence", description: "Wiki & spaces" },
  { key: "custom",     label: "Custom API", description: "Your own system" },
];

export type OnboardingInput = {
  companyName: string;
  companySize: string;
  industry: string;
  sources: string[];
};

export const PLAN_KEYS = ["free", "starter", "pro", "scale"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/**
 * Onboarding is complete only once a plan has been chosen — a profile without
 * a plan means the user bailed on the final step and must resume.
 */
export function isOnboardingComplete(
  profile: { plan: string | null } | null | undefined
): boolean {
  return !!profile && !!profile.plan;
}
