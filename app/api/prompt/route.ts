import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  citationsFor,
  emitWords,
  retrieveDocuments,
  streamRagAnswer,
} from "@/lib/chat/rag";
import { parseSubmission } from "@/lib/interactive/references";
import { classifyIntent } from "@/lib/interactive/intentClassifier";
import { createAgentConfig } from "@/lib/interactive/agentConfigurator";
import { resolveSearchSources } from "@/lib/interactive/sourceScope";
import {
  draftFromSources,
  draftFromWritePrompt,
  writeBrainBlock,
} from "@/lib/interactive/pageMutation";
import type { PromptSubmission } from "@/lib/interactive/types";

export const runtime = "nodejs";

/**
 * POST /api/prompt — the interactive intelligence entry point (blueprint §2).
 *
 * Accepts the structured @-mention submission contract:
 *   { text, references: [{type,id,label,pos}], inputMethod, conversationId }
 *
 * Flow: parse references → classify intent → audit (PromptEvent) → route:
 *   QUERY  → RAG engine (read-only)
 *   CONFIG → Agent Configurator (standing rule) + plain-language confirmation
 *   WRITE  → Page Mutation Engine (BrainBlock) + confirmation
 *
 * SSE events (superset of /api/chat):
 *   { type: "intent", intent }                       routing decision
 *   { type: "clarify", question }                    low confidence — no action taken
 *   { type: "token", text } / { type: "citations" }  answer stream (QUERY)
 *   { type: "config_saved", configId, name }         standing rule created
 *   { type: "block_written", block }                 brain block persisted
 *   { type: "done" } / { type: "error", message }
 */
export async function POST(req: NextRequest) {
  const cookie = (await headers()).get("cookie") || "";
  const session = await auth.api.getSession({ headers: { cookie } });
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = session.user.id;

  let submission: PromptSubmission;
  try {
    submission = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  if (!submission?.text?.trim()) {
    return new Response(JSON.stringify({ error: "text is required" }), { status: 400 });
  }

  const parsed = parseSubmission(submission);
  const classified = await classifyIntent(parsed);

  // Audit every prompt and its routing (blueprint §10 PromptEvent).
  prisma.promptEvent
    .create({
      data: {
        userId,
        rawText: submission.text,
        references: (submission.references as object[]) ?? undefined,
        intent: classified.intent,
        model: parsed.model,
        inputMethod: submission.inputMethod === "voice" ? "voice" : "typed",
      },
    })
    .catch((err) => console.error("[api/prompt] audit write failed:", err));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        send({ type: "intent", intent: classified.intent });

        // Low confidence: ask a one-line clarifying question, act on nothing
        // (blueprint §4.3).
        if (classified.clarifyingQuestion) {
          send({ type: "clarify", question: classified.clarifyingQuestion });
          await emitWords(classified.clarifyingQuestion, send);
          send({ type: "done" });
          return;
        }

        switch (classified.intent) {
          case "CONFIG": {
            const { config, confirmation } = await createAgentConfig(
              userId,
              parsed,
              submission.text
            );
            await emitWords(confirmation, send);
            send({ type: "config_saved", configId: config.id, name: config.name });
            break;
          }

          case "WRITE": {
            const target = parsed.writeTargets[0] ?? "brain";

            // A write may be a dictation ("remember that X") or an instruction
            // to go and learn something first ("edit @brain with who was given
            // a task from @notion and why"). If the prompt points at sources,
            // read them and synthesize; otherwise the user's words ARE the
            // content.
            const sources = resolveSearchSources(parsed, "WRITE");
            let draft;
            let mode: "synthesized" | "extractive" | "dictation" = "dictation";
            let degradedReason: string | undefined;
            let docs: Awaited<ReturnType<typeof retrieveDocuments>> = [];

            if (sources.length > 0) {
              send({ type: "status", message: `Reading your ${sources.join(", ")}…` });
              docs = await retrieveDocuments(userId, parsed.prose, { sources });

              // Nothing retrieved means nothing was learned. Writing the user's
              // instruction to the Brain here would look like success while
              // recording no knowledge at all — say so instead.
              if (docs.length === 0) {
                await emitWords(
                  `I couldn't find anything in ${sources.join(", ")} to write about, so I ` +
                    `haven't changed @${target}. Check that the source is synced and its ` +
                    `documents have finished processing, then try again.`,
                  send
                );
                send({ type: "citations", citations: [] });
                break;
              }

              const result = await draftFromSources(parsed.prose, docs);
              draft = result.draft;
              mode = result.mode;
              degradedReason = result.degradedReason;
            } else {
              draft = draftFromWritePrompt(parsed.prose);
            }

            const block = await writeBrainBlock(userId, draft);

            const grounded = docs.length
              ? ` I read ${docs.length} document${docs.length === 1 ? "" : "s"} from ${sources.join(", ")}.`
              : "";
            // Never claim a synthesized write when the sources were only quoted.
            const degraded =
              mode === "extractive"
                ? ` Heads up: AI synthesis was unavailable (${degradedReason}), so the block ` +
                  `quotes the sources directly instead of summarising them.`
                : "";
            await emitWords(
              block.status === "active"
                ? `Done — I've written **${block.title}** to @${target} as a ${block.type.replace(/_/g, " ")}.${grounded}${degraded}`
                : `Saved for review — this ${block.type.replace(/_/g, " ")} is in the @${target} review queue until you approve it.${grounded}${degraded}`,
              send
            );

            send({
              type: "block_written",
              block: {
                id: block.id,
                type: block.type,
                title: block.title,
                status: block.status,
                body: block.body,
              },
            });

            // Show where the written knowledge came from.
            if (docs.length > 0) {
              send({ type: "citations", citations: citationsFor(docs) });
            }
            break;
          }

          case "QUERY":
          default: {
            await streamRagAnswer({
              userId,
              query: parsed.prose,
              send,
              model: parsed.model,
              sources: resolveSearchSources(parsed, "QUERY"),
            });
            break;
          }
        }

        send({ type: "done" });
      } catch (err) {
        console.error("[api/prompt] stream error:", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
