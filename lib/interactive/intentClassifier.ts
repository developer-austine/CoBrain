import type { ClassifiedPrompt, Intent, ParsedPrompt } from "./types";
import {
  isLlmAvailable,
  noteLlmFailure,
  noteLlmSuccess,
} from "@/lib/chat/llmAvailability";

/**
 * Intent classification (blueprint §4): every prompt is QUERY, CONFIG or
 * WRITE — classified BEFORE acting. Primary path is a fast LLM call; the
 * deterministic heuristic below is both the no-API fallback and the
 * unit-testable core, built from the signal table in §4.2.
 */

const CONFIG_SIGNALS =
  /\b(configure|set (yourself|your self|myself|it) up|from now on|going forward|always|every time|whenever|each time|standing (rule|instruction)|act as|behave as)\b/i;

const WRITE_VERBS =
  /\b(add|update|write|record|note|log|append|save|store|put|insert)\b/i;

const QUERY_SIGNALS =
  /\b(what|who|when|where|why|how|which|show me|find|list|search|summari[sz]e for me|tell me|do (i|we) have|did (i|we))\b/i;

/** Deterministic classifier — the LLM fallback and the tested contract. */
export function classifyHeuristically(parsed: ParsedPrompt): ClassifiedPrompt {
  const prose = parsed.prose;
  const hasWriteTarget = parsed.writeTargets.length > 0;

  const config = CONFIG_SIGNALS.test(prose);
  const write = hasWriteTarget && WRITE_VERBS.test(prose);
  const query = QUERY_SIGNALS.test(prose);

  // CONFIG dominates: "from now on, add meeting notes to @brain" is a rule,
  // not a one-time write (§5.1).
  if (config) {
    return { intent: "CONFIG", confidence: write || hasWriteTarget ? 0.9 : 0.8 };
  }
  if (write && !query) {
    return { intent: "WRITE", confidence: 0.85 };
  }
  if (write && query) {
    // "add ... ?" both signals — too ambiguous to guess (§4.3).
    return {
      intent: "WRITE",
      confidence: 0.5,
      clarifyingQuestion: "Do you want me to answer that, or update the page?",
    };
  }
  return { intent: "QUERY", confidence: query ? 0.9 : 0.7 };
}

const CLASSIFIER_SYSTEM = `You are the intent router for Company Brain. Classify the user's prompt into exactly one intent:

- QUERY: the user wants an answer from their knowledge base. Read-only.
- CONFIG: the user is programming standing behaviour ("configure yourself...", "from now on...", "always..."). Creates a durable rule.
- WRITE: the user wants to change a page right now ("add a note to the brain that...").

Reply with ONLY a JSON object: {"intent":"QUERY|CONFIG|WRITE","confidence":0.0-1.0}

Examples:
"What did we decide about pricing?" -> {"intent":"QUERY","confidence":0.98}
"Configure yourself as an agent brain that gathers meeting info and updates the brain page" -> {"intent":"CONFIG","confidence":0.97}
"Add a note that Q3 pricing is final" (write target: brain) -> {"intent":"WRITE","confidence":0.95}
"From now on summarise every meeting into the brain" -> {"intent":"CONFIG","confidence":0.96}
"Show me the burnout forecast for engineering" -> {"intent":"QUERY","confidence":0.97}`;

/**
 * Classify with the LLM when available, falling back to heuristics on any
 * failure (no key, no credits, malformed output). Never throws.
 */
export async function classifyIntent(parsed: ParsedPrompt): Promise<ClassifiedPrompt> {
  const heuristic = classifyHeuristically(parsed);
  // No key, exhausted credits, or rate-limited — the heuristic is a perfectly
  // good classifier on its own, so don't pay for a doomed round-trip.
  if (!isLlmAvailable()) return heuristic;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 100,
      system: CLASSIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Prompt: ${parsed.prose}\nWrite targets: ${
            parsed.writeTargets.join(", ") || "(none)"
          }`,
        },
      ],
    });
    noteLlmSuccess();
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristic;
    const out = JSON.parse(match[0]) as { intent?: string; confidence?: number };
    if (out.intent === "QUERY" || out.intent === "CONFIG" || out.intent === "WRITE") {
      const confidence = typeof out.confidence === "number" ? out.confidence : 0.8;
      if (confidence < 0.6) {
        return {
          intent: out.intent as Intent,
          confidence,
          clarifyingQuestion: "Do you want me to answer that, or update the page?",
        };
      }
      return { intent: out.intent as Intent, confidence };
    }
    return heuristic;
  } catch (err) {
    noteLlmFailure(err);
    return heuristic;
  }
}
