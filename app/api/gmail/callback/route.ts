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
      new URL(`/?gmailError=${encodeURIComponent(error)}`, req.url)
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

  const clientId     = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = config.connectorRedirectUri("gmail");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("[gmail/callback] Token exchange failed:", await tokenRes.text());
    return NextResponse.json({ error: "Token exchange failed" }, { status: 500 });
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const profileRes  = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const profile     = profileRes.ok ? await profileRes.json() : {};
  const gmailAddress: string = profile.email ?? "";
  const tokenExpiry = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

  await prisma.gmailConnection.upsert({
    where:  { workflowId_nodeId: { workflowId, nodeId } },
    create: {
      workflowId,
      nodeId,
      userId,
      accessToken:  access_token,
      refreshToken: refresh_token ?? null,
      tokenExpiry,
      email:        gmailAddress,
    },
    update: {
      userId,
      accessToken:  access_token,
      refreshToken: refresh_token ?? null,
      tokenExpiry,
      email:        gmailAddress,
    },
  });

  const editorUrl = new URL(
    `/connectors/${workflowId}?gmailConnected=true&nodeId=${nodeId}`,
    req.url
  );
  return NextResponse.redirect(editorUrl);
}