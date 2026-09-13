import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config/env";

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

    const clientId = process.env.GITHUB_CLIENT_ID!;
    const redirectUri = config.connectorRedirectUri("github");

    const state = Buffer.from(
        JSON.stringify({ nodeId, workflowId })
    ).toString("base64url");

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        login: "user",
        scope: "repo, read:user",
        state,
        // code_challenge: "",
        // code_challenge_method: "S256",
        // allow_signup: "true",
        // prompt: "consent",
    });

    const githubAuthUrl = `https://github.com/login/oauth/authorize?${params}`;
    return NextResponse.redirect(githubAuthUrl);
}