import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * POST /api/search
 *
 * Search the Qdrant vector database for documents matching a query.
 * Uses sentence-transformers embedding model (all-MiniLM-L6-v2, 384-dim).
 *
 * Request: { query: string, limit?: number }
 * Response: { results: [ { text, source, author, timestamp, chunk_index, total_chunks }, ... ] }
 *
 * Note: This endpoint embeds the query locally (requires model setup) or calls Python backend.
 */
export async function POST(req: NextRequest) {
  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = session.user.id;

  let body: { query?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, limit = 5 } = body;
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    // For now, call Python backend to embed query and search Qdrant
    // This requires the Python backend to be running with a search endpoint
    // Alternatively, use sentence-transformers-js (lightweight library)

    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";

    const response = await fetch(`${pythonBackendUrl}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        namespace: `${userId}:*`, // Search only user's namespace
        limit,
      }),
    });

    if (!response.ok) {
      console.error(`[search] Python backend error: ${response.status}`);
      return NextResponse.json(
        { error: "Search backend unavailable" },
        { status: 503 }
      );
    }

    const results = await response.json();
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[api/search] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
