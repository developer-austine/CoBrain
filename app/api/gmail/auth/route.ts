import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config/env";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nodeId      = searchParams.get("nodeId");
  const workflowId  = searchParams.get("workflowId");

  if (!nodeId || !workflowId) {
    return NextResponse.json(
      { error: "nodeId and workflowId are required" },
      { status: 400 }
    );
  }

  const clientId    = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = config.connectorRedirectUri("gmail");

  const state = Buffer.from(JSON.stringify({ nodeId, workflowId })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         SCOPES,
    access_type:   "offline",
    prompt:        "consent",
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return NextResponse.redirect(googleAuthUrl);
}