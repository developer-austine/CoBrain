import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  // Optimistic auth check: verify the session cookie exists. This runs in
  // the Edge runtime (no DB call), so it cannot import the pg-backed auth
  // instance. Full session validation happens in server components / server
  // actions via lib/get-session.ts, and API routes enforce their own auth
  // via auth.api.getSession().
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect dashboard / app page routes. API routes self-protect, and
    // public pages (sign-in, sign-up) are excluded by not matching here.
    "/",
    "/brain/:path*",
    "/sources/:path*",
    "/connectors/:path*",
    "/activity/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/onboarding",
    "/onboarding/:path*",
  ],
};
