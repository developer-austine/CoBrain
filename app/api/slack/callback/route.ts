import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config/env";

/**
 * Slack OAuth v2 callback.
 *
 * Note the response shape differs from every other connector here: the bot
 * token lives at `access_token` on the TOP level, while the user token is
 * nested under `authed_user`. Reading `authed_user.access_token` as the main
 * credential is the classic Slack integration bug — it authorises as the person
 * who installed the app, so the connector breaks the day they leave.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?slackError=${encodeURIComponent(error)}`, req.url)
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
  const session = await auth.api.getSession({
    headers: { cookie: headersList.get("cookie") || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = config.connectorRedirectUri("slack");

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Slack is not configured" }, { status: 503 });
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: { access_token?: string };
  };

  // Slack returns HTTP 200 with `ok: false` on failure, so the status code
  // alone would let a failed exchange through as a success.
  if (!body.ok || !body.access_token) {
    console.error("[slack/callback] token exchange failed:", body.error);
    return NextResponse.json(
      { error: `Slack token exchange failed: ${body.error ?? "unknown"}` },
      { status: 500 }
    );
  }

  await prisma.slackConnection.upsert({
    where: { workflowId_nodeId: { workflowId, nodeId } },
    create: {
      workflowId,
      nodeId,
      userId,
      accessToken: body.access_token,
      userToken: body.authed_user?.access_token ?? null,
      teamId: body.team?.id ?? null,
      teamName: body.team?.name ?? null,
      botUserId: body.bot_user_id ?? null,
      scope: body.scope ?? null,
    },
    update: {
      userId,
      accessToken: body.access_token,
      userToken: body.authed_user?.access_token ?? null,
      teamId: body.team?.id ?? null,
      teamName: body.team?.name ?? null,
      botUserId: body.bot_user_id ?? null,
      scope: body.scope ?? null,
    },
  });

  return NextResponse.redirect(
    new URL(`/connectors/${workflowId}?slackConnected=true&nodeId=${nodeId}`, req.url)
  );
}
