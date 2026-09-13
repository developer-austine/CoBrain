import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config/env";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nodeId     = searchParams.get("nodeId");
  const workflowId = searchParams.get("workflowId");

  if (!nodeId || !workflowId) {
    return NextResponse.json(
      { error: "nodeId and workflowId are required" },
      { status: 400 }
    );
  }

  const clientId    = process.env.NOTION_CLIENT_ID!;
  const redirectUri = config.connectorRedirectUri("notion");

  const state = Buffer.from(JSON.stringify({ nodeId, workflowId })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    owner:         "user",
    state,
  });

  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?${params}`;
  return NextResponse.redirect(notionAuthUrl);
}