import { NextRequest, NextResponse }  from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config/env";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?notionError=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  let nodeId: string;
  let workflowId: string;
  try {
    ({ nodeId, workflowId } = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    ));
  } catch {
    return NextResponse.json({ error: "Invalid state param" }, { status: 400 });
  }

  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const clientId     = process.env.NOTION_CLIENT_ID!;
  const clientSecret = process.env.NOTION_CLIENT_SECRET!;
  const redirectUri = config.connectorRedirectUri("notion");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      grant_type:   "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    console.error("[notion/callback] Token exchange failed:", await tokenRes.text());
    return NextResponse.json({ error: "Token exchange failed" }, { status: 500 });
  }

  const {
    access_token,
    bot_id,
    workspace_id,
    workspace_name,
  } = await tokenRes.json();

  await prisma.notionConnection.upsert({
    where:  { workflowId_nodeId: { workflowId, nodeId } },
    create: {
      workflowId,
      nodeId,
      userId,
      accessToken:   access_token,
      workspaceName: workspace_name ?? null,
      workspaceId:   workspace_id   ?? null,
      botId:         bot_id         ?? null,
    },
    update: {
      userId,
      accessToken:   access_token,
      workspaceName: workspace_name ?? null,
      workspaceId:   workspace_id   ?? null,
      botId:         bot_id         ?? null,
    },
  });

  const editorUrl = new URL(
    `/connectors/${workflowId}?notionConnected=true&nodeId=${nodeId}`,
    req.url
  );
  return NextResponse.redirect(editorUrl);
}