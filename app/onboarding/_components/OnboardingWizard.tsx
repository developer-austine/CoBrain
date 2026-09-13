"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { completeOnboarding, choosePlan } from "@/actions/onboarding/onboarding";
import { COMPANY_SIZES, INDUSTRIES, SOURCE_OPTIONS } from "@/lib/onboarding/constants";
import PricingSection from "@/components/pricing/PricingSection";
import type { PricingPlan } from "@/lib/pricing/plans";
import {
  SlackIcon, NotionIcon, GmailIcon, GoogleDriveIcon,
  JiraIcon, LinearIcon, GitHubIcon, ConfluenceIcon,
} from "@/assets/connector-icons";

/** Icon per onboarding source key (Custom API falls back to a document glyph). */
const SOURCE_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  gmail: GmailIcon,
  slack: SlackIcon,
  notion: NotionIcon,
  drive: GoogleDriveIcon,
  github: GitHubIcon,
  jira: JiraIcon,
  linear: LinearIcon,
  confluence: ConfluenceIcon,
  custom: ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-500" />
      <path d="M14 2v6h6M8 13h8M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="stroke-sky-500" />
    </svg>
  ),
};

const STEPS = [
  "Welcome",
  "Company",
  "Size",
  "Industry",
  "Sources",
  "Personalizing",
  "Plan",
] as const;

/**
 * Named indices. The wizard branches on the step number in a dozen places, and
 * with bare numbers inserting a step means finding and shifting every one of
 * them correctly — exactly the edit that silently sends "back" to the wrong
 * screen. Adding a step is now one entry here plus its own block.
 */
const STEP = {
  welcome: 0,
  company: 1,
  size: 2,
  industry: 3,
  sources: 4,
  personalizing: 5,
  plan: 6,
} as const;

const PERSONALIZING_LINES = [
  "Creating your workspace…",
  "Wiring your sources into the pipeline…",
  "Connecting normalizer → PII scrubber → chunker…",
  "Setting up embeddings & vector store…",
  "Polishing your workflow…",
];

/**
 * Six-step onboarding: welcome → company name → size → sources →
 * personalizing (creates the pre-wired workflow) → plan selection.
 * A resumeWorkflowId means the profile already exists but no plan was
 * chosen — jump straight back to the plan step.
 */
export default function OnboardingWizard({
  resumeWorkflowId = null,
}: {
  resumeWorkflowId?: string | null;
}) {
  const router = useRouter();
  // Annotated `number`: STEP is `as const`, so an inferred initial state would
  // narrow to the literal union `0 | 6` and reject every other step.
  const [step, setStep] = useState<number>(
    resumeWorkflowId ? STEP.plan : STEP.welcome
  );
  const [companyName, setCompanyName] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [industry, setIndustry] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(resumeWorkflowId);
  const [error, setError] = useState<string | null>(null);
  const [personalizingLine, setPersonalizingLine] = useState(0);
  const [choosingPlan, setChoosingPlan] = useState<string | null>(null);
  const personalizeStarted = useRef(false);

  const toggleSource = (key: string) =>
    setSources((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );

  // ── Step 4: run the real work while the dots dance ─────────────────────────
  useEffect(() => {
    if (step !== STEP.personalizing || personalizeStarted.current) return;
    personalizeStarted.current = true;

    const lineTimer = setInterval(
      () => setPersonalizingLine((i) => (i + 1) % PERSONALIZING_LINES.length),
      1400
    );

    const startedAt = Date.now();
    (async () => {
      try {
        const { workflowId } = await completeOnboarding({
          companyName,
          companySize,
          industry,
          sources,
        });
        // Let the animation breathe even when the server is fast.
        const elapsed = Date.now() - startedAt;
        if (elapsed < 2800) await new Promise((r) => setTimeout(r, 2800 - elapsed));
        setWorkflowId(workflowId);
        setStep(STEP.plan);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        personalizeStarted.current = false;
        setStep(STEP.sources);
      } finally {
        clearInterval(lineTimer);
      }
    })();

    return () => clearInterval(lineTimer);
  }, [step, companyName, companySize, industry, sources]);

  const canContinue =
    step === STEP.company ? companyName.trim().length > 1 :
    step === STEP.size ? companySize !== "" :
    step === STEP.industry ? industry !== "" :
    step === STEP.sources ? sources.length > 0 :
    true;

  const next = () => {
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const selectPlan = async (plan: PricingPlan) => {
    if (!workflowId || choosingPlan) return;
    if (plan.monthlyPrice !== 0) {
      // Billing isn't live yet — be honest and keep the user moving on Free.
      toast.info(
        plan.ctaText === "Contact sales"
          ? "Sales channel opens soon — the Free plan is yours meanwhile."
          : "Paid plans launch soon — everything you need today is on Free."
      );
      return;
    }
    setChoosingPlan(plan.name);
    try {
      await choosePlan("free"); // unlocks the rest of the app
      router.push(`/connectors/${workflowId}`);
    } catch (err) {
      setChoosingPlan(null);
      toast.error(err instanceof Error ? err.message : "Could not select plan");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4">
      <style>{`
        @keyframes onboard-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40% { transform: translateY(-10px); opacity: 1; }
        }
        @keyframes onboard-fade {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .onboard-step { animation: onboard-fade 0.3s ease forwards; }
      `}</style>

      {/* ── Progress dots ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-10 pb-4">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-[#3a7d2c]"
                  : i < step
                  ? "w-2 bg-[#3a7d2c]/60"
                  : "w-2 bg-stone-200"
              }`}
            />
          </div>
        ))}
      </div>

      <div
        className={`flex-1 w-full ${
          step === STEP.plan ? "max-w-7xl" : "max-w-2xl"
        } flex flex-col items-center justify-center pb-16 text-center`}
      >
        {error && (
          <p className="mb-6 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        {/* ── Step 0: welcome ─────────────────────────────────────────────── */}
        {step === STEP.welcome && (
          <div key="s0" className="onboard-step flex flex-col items-center gap-6">
            <div className="w-16 h-16 rounded-3xl bg-[#3a7d2c]/10 flex items-center justify-center">
              <img src="/logo.svg" alt="CoBrain" width={34} height={34} />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-stone-900">
              Let&apos;s get you started
            </h1>
            <p className="text-stone-500 max-w-md leading-relaxed">
              In about a minute we&apos;ll set up your company brain — tell us who you
              are, pick your sources, and we&apos;ll wire the whole pipeline for you.
            </p>
            <button
              onClick={next}
              className="mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#3a7d2c] text-white text-sm font-semibold hover:bg-[#2f6423] transition-colors"
            >
              Get started <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* ── Step 1: company name ────────────────────────────────────────── */}
        {step === STEP.company && (
          <div key="s1" className="onboard-step flex flex-col items-center gap-6 w-full">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900">
              What&apos;s your company called?
            </h2>
            <p className="text-stone-500">We&apos;ll name your workspace after it.</p>
            <input
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canContinue && next()}
              placeholder="e.g. Acme Inc."
              className="w-full max-w-md text-center text-lg px-5 py-3.5 rounded-xl border-2 border-stone-200 focus:border-[#3a7d2c] outline-none transition-colors placeholder:text-stone-300"
            />
          </div>
        )}

        {/* ── Step 2: company size ────────────────────────────────────────── */}
        {step === STEP.size && (
          <div key="s2" className="onboard-step flex flex-col items-center gap-6 w-full">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900">
              How big is {companyName.trim() || "your team"}?
            </h2>
            <p className="text-stone-500">This helps us tune your pipeline defaults.</p>
            <div className="relative w-full max-w-md">
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className="w-full appearance-none text-center text-lg px-5 py-3.5 rounded-xl border-2 border-stone-200 focus:border-[#3a7d2c] outline-none transition-colors bg-white text-stone-800"
              >
                <option value="" disabled>
                  Select company size…
                </option>
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} people
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-stone-400">
                ▾
              </span>
            </div>
          </div>
        )}

        {/* ── Step 3: industry ────────────────────────────────────────────── */}
        {step === STEP.industry && (
          <div key="s3i" className="onboard-step flex flex-col items-center gap-6 w-full">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900">
              What industry are you in?
            </h2>
            <p className="text-stone-500">
              Your signals get named in your field&apos;s language — the same
              measurement reads as &ldquo;code review time&rdquo; at a software
              company and &ldquo;chart sign-off time&rdquo; at a clinic.
            </p>
            <div className="relative w-full max-w-md">
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full appearance-none text-center text-lg px-5 py-3.5 rounded-xl border-2 border-stone-200 focus:border-[#3a7d2c] outline-none transition-colors bg-white text-stone-800"
              >
                <option value="" disabled>
                  Select your industry…
                </option>
                {INDUSTRIES.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-stone-400">
                ▾
              </span>
            </div>

            {/* Said plainly and at the point of collection, because "what will
                you do with this" is a fair question to have about every field
                on this form — and the honest answer is a short one. */}
            <p className="max-w-md text-[12px] leading-relaxed text-stone-400">
              Everything you tell us in these steps is used to set up and
              customise your workspace — nothing here is used to train any
              model, yours or anyone else&apos;s.
            </p>
          </div>
        )}

        {/* ── Step 3: sources ─────────────────────────────────────────────── */}
        {step === STEP.sources && (
          <div key="s3" className="onboard-step flex flex-col items-center gap-6 w-full">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900">
              Where does your knowledge live?
            </h2>
            <p className="text-stone-500">
              Pick every source you want in your brain — we&apos;ll wire them all up.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
              {SOURCE_OPTIONS.map((opt) => {
                const Icon = SOURCE_ICONS[opt.key];
                const selected = sources.includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    onClick={() => toggleSource(opt.key)}
                    className={`relative flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-5 transition-all ${
                      selected
                        ? "border-[#3a7d2c] bg-[#3a7d2c]/[0.06] shadow-sm"
                        : "border-stone-200 hover:border-stone-300 bg-white"
                    }`}
                  >
                    {selected && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#3a7d2c] flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </span>
                    )}
                    {Icon && <Icon size={28} />}
                    <span className="text-sm font-semibold text-stone-800">{opt.label}</span>
                    <span className="text-[11px] text-stone-400 leading-tight">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-stone-400">
              {sources.length === 0
                ? "Select at least one source"
                : `${sources.length} selected`}
            </p>
          </div>
        )}

        {/* ── Step 4: personalizing ───────────────────────────────────────── */}
        {step === STEP.personalizing && (
          <div key="s4" className="onboard-step flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900">
              Personalizing your workflow
            </h2>
            <div className="flex items-end gap-2 h-10">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="block w-3 h-3 rounded-full bg-[#3a7d2c]"
                  style={{
                    animation: "onboard-bounce 1.2s ease-in-out infinite",
                    animationDelay: `${i * 0.18}s`,
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-stone-400 h-5 transition-opacity">
              {PERSONALIZING_LINES[personalizingLine]}
            </p>
          </div>
        )}

        {/* ── Step 5: plans (ticket-cut pricing grid) ─────────────────────── */}
        {step === STEP.plan && (
          <div key="s5" className="onboard-step w-full py-10">
            <PricingSection
              title="Simple pricing, serious results"
              subtitle="Start for free, upgrade when you're ready. Every plan includes unlimited access to core features — no credit card needed to begin."
              onSelect={selectPlan}
              busyPlan={choosingPlan}
            />
            <p className="mt-10 text-xs text-muted-foreground max-w-md mx-auto">
              Free plan: you&apos;ll land in your generated workflow — connect each source
              and press <span className="font-medium text-foreground/70">Sync</span>, then{" "}
              <span className="font-medium text-foreground/70">Execute</span> to bring your
              brain to life.
            </p>
          </div>
        )}

        {/* ── Nav buttons (hidden on welcome, personalizing & plans) ───────────
            Named bounds, not bare numbers. This range was `>= 1 && <= 3` and
            silently stopped covering Sources the moment Industry was inserted
            ahead of it — leaving that step with no way forward at all. STEP.*
            moves with the list; a literal does not. */}
        {step >= STEP.company && step <= STEP.sources && (
          <div className="flex items-center gap-3 mt-10">
            <button
              onClick={back}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-stone-200 text-sm font-medium text-stone-500 hover:border-stone-300 transition-colors"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button
              onClick={next}
              disabled={!canContinue}
              className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-[#3a7d2c] text-white text-sm font-semibold hover:bg-[#2f6423] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors"
            >
              {step === STEP.sources ? "Build my workflow" : "Continue"} <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
