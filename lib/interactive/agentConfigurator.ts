import prisma from "@/lib/prisma";
import { truncateWords } from "@/lib/chat/format";
import { DOMAIN_EVENTS, type DomainEvent, type ParsedPrompt } from "./types";

/**
 * Agent Configurator (blueprint §5): a CONFIG prompt is NOT a one-time
 * action — it programs standing behaviour. We decompose the prose into an
 * AgentConfig record (triggers, action, write target, persistence), persist
 * it, and confirm back in plain language. The rules engine then fires it on
 * every matching domain event.
 */

export type DecomposedConfig = {
  name: string;
  triggers: DomainEvent[];
  action: string;
  writeTarget: string;
  persistence: "permanent" | "until_date";
  extraFlags: Record<string, unknown>;
};

const TRIGGER_SIGNALS: Record<DomainEvent, RegExp> = {
  meeting_attended: /\b(meetings?|standups?|calls?|syncs?)\b/i,
  tft_forecast_completed: /\b(forecasts?|tft|predictions?|projections?)\b/i,
  document_processed: /\b(documents?|emails?|pages?|files?|synced|ingested)\b/i,
  daily_digest_due: /\b(daily|weekly|digest|brief(ing)?|every (day|morning|week))\b/i,
};

/**
 * Deterministic decomposition of a CONFIG prompt (§5.2). Pure and testable —
 * an LLM can refine this later, but the contract stays identical.
 */
export function decomposeConfigPrompt(parsed: ParsedPrompt): DecomposedConfig {
  const prose = parsed.prose;

  const triggers = DOMAIN_EVENTS.filter((event) => TRIGGER_SIGNALS[event].test(prose));

  const writeTarget = parsed.writeTargets[0] ?? "brain";

  const extraFlags: Record<string, unknown> = {};
  if (/\b(connector|used as (a|one of the) connectors?)\b/i.test(prose)) {
    extraFlags.promoteBrainToConnector = true;
  }
  if (parsed.model) extraFlags.model = parsed.model;

  return {
    name: truncateWords(prose, 60) || "Standing rule",
    // A config with no recognizable trigger still saves — it fires on the
    // generic document_processed event rather than silently never running.
    triggers: triggers.length ? triggers : ["document_processed"],
    action: "summarise_and_write",
    writeTarget,
    persistence: /\buntil\b/i.test(prose) ? "until_date" : "permanent",
    extraFlags,
  };
}

/** Persist a standing rule and return the plain-language confirmation (§5.4). */
export async function createAgentConfig(userId: string, parsed: ParsedPrompt, rawText: string) {
  const decomposed = decomposeConfigPrompt(parsed);

  const config = await prisma.agentConfig.create({
    data: {
      userId,
      name: decomposed.name,
      triggers: decomposed.triggers,
      action: decomposed.action,
      writeTarget: decomposed.writeTarget,
      persistence: decomposed.persistence,
      extraFlags: decomposed.extraFlags as object,
      sourceText: rawText,
    },
  });

  const triggerWords = decomposed.triggers
    .map((t) => t.replace(/_/g, " "))
    .join(" and ");

  return {
    config,
    confirmation:
      `Done. From now on, whenever ${triggerWords} happens, I'll ${
        decomposed.action === "summarise_and_write" ? "summarise it" : decomposed.action
      } and post it to @${decomposed.writeTarget}. ` +
      `You can review or disable this rule anytime on the Brain page under Standing Rules.`,
  };
}
