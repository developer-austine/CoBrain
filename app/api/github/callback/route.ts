import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config/env";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?githubError=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state" },
      { status: 400 }
    );
  }

  let nodeId: string;
  let workflowId: string;

  try {
    const parsed = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    );

    nodeId = parsed.nodeId;
    workflowId = parsed.workflowId;
  } catch {
    return NextResponse.json(
      { error: "Invalid state parameter" },
      { status: 400 }
    );
  }

  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = session.user.id;

  const clientId = process.env.GITHUB_CLIENT_ID!;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
  const redirectUri = config.connectorRedirectUri("github");

  const tokenRes = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: "",
      }),
    }
  );

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[github/callback] token error:", errText);

    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  }

  const data = await tokenRes.json();

  const accessToken = data.access_token;
  const tokenType = data.token_type;
  const scope = data.scope;

  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token returned" },
      { status: 500 }
    );
  }

  await prisma.gitHubConnection.upsert({
    where: {
      workflowId_nodeId: {
        workflowId,
        nodeId,
      },
    },
    create: {
      workflowId,
      nodeId,
      userId,
      accessToken,
      repository: "",
    },
    update: {
      userId,
      accessToken,
      updatedAt: new Date(),
    },
  });

  const redirectUrl = new URL(
    `/connectors/${workflowId}?githubConnected=true&nodeId=${nodeId}`,
    req.url
  );

  return NextResponse.redirect(redirectUrl);
}