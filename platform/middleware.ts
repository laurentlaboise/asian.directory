import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Runs on every non-asset route. Two jobs:
 *
 *  1. Per-request nonce-based CSP. A static `script-src 'self'` would block Next.js's own
 *     inline hydration/streaming scripts and break the app, so we mint a nonce here, put it
 *     on the request (Next injects it into its scripts) and on the response header.
 *  2. Optimistic auth gate for /dashboard/*. Presence-only check (fast, edge-safe); the real
 *     session validation happens server-side in the page/route via auth.api.getSession().
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' only in dev (React Fast Refresh); never in production.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Auth gate (must use the configured cookiePrefix, else the lookup always misses).
  if (req.nextUrl.pathname.startsWith("/dashboard")) {
    const session = getSessionCookie(req, { cookiePrefix: "sead" });
    if (!session) {
      const url = new URL("/login", req.url);
      url.searchParams.set("next", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp); // Next reads the nonce from here

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // All routes except Next static assets and the favicon.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
