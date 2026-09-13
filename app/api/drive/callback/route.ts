import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config/env";

/** Google OAuth callback for Drive. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?driveError=${encodeURIComponent(error)}`, req.url)
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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = config.connectorRedirectUri("drive");

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google is not configured" }, { status: 503 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const body = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !body.access_token) {
    console.error("[drive/callback] token exchange failed:", body.error_description ?? body.error);
    return NextResponse.json({ error: "Token exchange failed" }, { status: 500 });
  }

  // Google only returns a refresh token on the FIRST consent for a scope set.
  // Re-authorising without `prompt=consent` yields none, so preserve the stored
  // one rather than overwriting it with null and silently breaking every
  // unattended sync from then on.
  const existing = await prisma.driveConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
    select: { refreshToken: true },
  });
  const refreshToken = body.refresh_token ?? existing?.refreshToken ?? null;

  let email: string | null = null;
  try {
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (infoRes.ok) email = ((await infoRes.json()) as { email?: string }).email ?? null;
  } catch {
    // Cosmetic only — the connection works without knowing which account it is.
  }

  const tokenExpiry = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);

  await prisma.driveConnection.upsert({
    where: { workflowId_nodeId: { workflowId, nodeId } },
    create: {
      workflowId,
      nodeId,
      userId,
      accessToken: body.access_token,
      refreshToken,
      tokenExpiry,
      email,
    },
    update: {
      userId,
      accessToken: body.access_token,
      refreshToken,
      tokenExpiry,
      email,
    },
  });

  return NextResponse.redirect(
    new URL(`/connectors/${workflowId}?driveConnected=true&nodeId=${nodeId}`, req.url)
  );
}
