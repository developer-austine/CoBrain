import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config/env";

/**
 * Bot scopes.
 *
 * `channels:history` and `groups:history` are the point of the connector;
 * `*:read` is needed to list channels and resolve names, and `users:read`
 * turns a `U024BE7LH` author into a person's name. Nothing here can post or
 * modify — a knowledge connector that could write to Slack would be a strictly
 * larger blast radius for no benefit.
 */
const SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "users:read",
].join(",");

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

  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = config.connectorRedirectUri("slack");

  // Fail loudly rather than bouncing the user to a Slack error page that says
  // "invalid_client_id" and gives them nothing to act on.
  if (!clientId) {
    return NextResponse.json(
      { error: "Slack is not configured — set SLACK_CLIENT_ID" },
      { status: 503 }
    );
  }

  const state = Buffer.from(JSON.stringify({ nodeId, workflowId })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return NextResponse.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
}
