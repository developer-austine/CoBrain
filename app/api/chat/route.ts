import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { streamRagAnswer } from "@/lib/chat/rag";

export const runtime = "nodejs";

/**
 * POST /api/chat — legacy RAG chat endpoint (plain query in, SSE out).
 * The interactive layer's POST /api/prompt supersedes this; both share the
 * same RAG core in lib/chat/rag.ts.
 *
 * Stream protocol (each line `data: <json>\n\n`):
 *   { type: "token", text }            incremental answer text
 *   { type: "citations", citations }   resolved sources (once, near the end)
 *   { type: "done" }                   stream complete
 *   { type: "error", message }         something failed
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

  let query = "";
  try {
    ({ query } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  if (!query || !query.trim()) {
    return new Response(JSON.stringify({ error: "query is required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        await streamRagAnswer({ userId, query, send });
        send({ type: "done" });
      } catch (err: any) {
        console.error("[api/chat] stream error:", err);
        send({ type: "error", message: err?.message || "Stream failed" });
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
