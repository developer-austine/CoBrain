import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * AssemblyAI Universal Streaming (v3). The old v2 realtime API
 * (POST /v2/realtime/token) has been retired and now 404s — do not resurrect it.
 */
const STT_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";
const TOKEN_TTL_SECONDS = 300;

/**
 * POST /api/stt/token — mint a short-lived AssemblyAI streaming token so the
 * browser can stream microphone audio over WebSocket without ever seeing the
 * API key (blueprint §7: voice is only an input method).
 *
 * Requires ASSEMBLYAI_API_KEY in the server environment. NOTE: Next.js only
 * loads the ROOT .env — a key that lives only in backend/.env (used by the
 * Python stack) will not be visible here. Returns 503 when STT isn't configured
 * so the UI can degrade gracefully.
 */
export async function POST() {
  const cookie = (await headers()).get("cookie") || "";
  const session = await auth.api.getSession({ headers: { cookie } });
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Speech-to-text is not configured (missing ASSEMBLYAI_API_KEY)" },
      { status: 503 }
    );
  }

  try {
    const r = await fetch(`${STT_TOKEN_URL}?expires_in_seconds=${TOKEN_TTL_SECONDS}`, {
      method: "GET",
      headers: { Authorization: apiKey },
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[stt/token] AssemblyAI token request failed:", r.status, detail);
      return Response.json({ error: "Could not start voice session" }, { status: 502 });
    }
    const { token } = await r.json();
    return Response.json({ token });
  } catch (err) {
    console.error("[stt/token] error:", err);
    return Response.json({ error: "Could not start voice session" }, { status: 502 });
  }
}
