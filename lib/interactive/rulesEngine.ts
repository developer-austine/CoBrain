import prisma from "@/lib/prisma";
import { writeBrainBlock } from "./pageMutation";
import type { BrainBlockType, DomainEvent } from "./types";

/**
 * Event-driven rules engine (blueprint §5.3): domain events fire, we look up
 * the user's enabled AgentConfigs whose triggers match, and execute each
 * action — typically a Page Mutation Engine write to @brain.
 *
 * Emitters today: the future meeting agent, the TFT forecaster, and the
 * pipeline monitor. The engine is emitter-agnostic — anything server-side
 * can call emitDomainEvent().
 */

export type DomainEventPayload = {
  /** Human-readable headline of what happened. */
  title: string;
  /** The derived content to write (summary, forecast text, etc.). */
  body: string;
  /** AI confidence in the derived content (0–1). */
  confidence?: number;
  blockType?: BrainBlockType;
  sourceRefs?: unknown[];
};

const EVENT_BLOCK_TYPE: Record<DomainEvent, BrainBlockType> = {
  meeting_attended: "meeting_summary",
  tft_forecast_completed: "forecast",
  document_processed: "note",
  daily_digest_due: "brief",
};

/**
 * Fire a domain event for a user. Returns the blocks written (one per
 * matching standing rule). Fail-soft per rule — one bad rule never blocks
 * the others.
 */
export async function emitDomainEvent(
  userId: string,
  event: DomainEvent,
  payload: DomainEventPayload
) {
  const configs = await prisma.agentConfig.findMany({
    where: { userId, enabled: true, triggers: { has: event } },
  });

  const written = [];
  for (const config of configs) {
    try {
      const block = await writeBrainBlock(userId, {
        type: payload.blockType ?? EVENT_BLOCK_TYPE[event],
        title: payload.title,
        body: payload.body,
        confidence: payload.confidence ?? 0.8,
        createdBy: "ai",
        sourceRefs: [
          { kind: "domain_event", event, configId: config.id },
          ...(payload.sourceRefs ?? []),
        ],
      });
      written.push(block);
    } catch (err) {
      console.error(`[rulesEngine] rule ${config.id} failed on ${event}:`, err);
    }
  }
  return written;
}
