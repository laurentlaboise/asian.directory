import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic auth gate for merchant routes. This only checks for the presence of a session
 * cookie (fast, edge-safe) and redirects unauthenticated users to /login. It is NOT a
 * security boundary on its own — every protected page/route MUST still validate the session
 * server-side via auth.api.getSession(). (Client-side-only auth was a core flaw in the
 * original admin dashboard; here the real check lives on the server.)
 */
export function middleware(req: NextRequest) {
  const session = getSessionCookie(req);
  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
