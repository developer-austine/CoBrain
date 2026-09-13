import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config/env";

/**
 * Drive scopes.
 *
 * `drive.readonly` covers every file the user can see. It is deliberately the
 * only Drive scope requested — the connector reads, and nothing about ingesting
 * knowledge requires the ability to modify or delete a customer's documents.
 *
 * This reuses the same Google OAuth client as Gmail, but consent is separate:
 * an existing Gmail grant carries `gmail.readonly` only, so it cannot read
 * Drive, and the user is asked again here. That is why Drive gets its own
 * connection row rather than borrowing Gmail's token — and its own callback,
 * since landing on Gmail's would store the grant as a GmailConnection.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get("nodeId");
  const workflowId = searchParams.get("workflowId");

  if (!nodeId || !workflowId) {
    return NextResponse.json(
      { error: "nodeId and workflowId are required" },
      { status: 400 }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = config.connectorRedirectUri("drive");

  if (!clientId) {
    return NextResponse.json(
      { error: "Google is not configured — set GOOGLE_CLIENT_ID" },
      { status: 503 }
    );
  }

  const state = Buffer.from(JSON.stringify({ nodeId, workflowId })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    // Drive syncs run unattended every 3 hours, so a refresh token is
    // mandatory: without `offline` + `consent` the grant dies in an hour and
    // the scheduler starts failing with no user present to re-authorise.
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
