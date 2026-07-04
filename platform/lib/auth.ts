import { betterAuth } from "better-auth";
import { env } from "./env";
import { pool } from "./db";
import { logAudit } from "./audit";

/**
 * Better Auth (ADR-006). Owns the identity tables (`user`, `session`, `account`,
 * `verification`) in the same Railway Postgres — generate them with:
 *   npx @better-auth/cli migrate
 *
 * Security posture:
 *  - secret comes only from env (fail-closed via lib/env.ts); no hardcoded fallback.
 *  - secure, httpOnly, sameSite cookies in production.
 *  - password minimum length raised to 10 (vs the original backend's weak 6).
 */
export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
  advanced: {
    cookiePrefix: "sead",
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
    },
  },
  // Auth-event audit (queued security item): record each session creation (login). logAudit is
  // best-effort and swallows its own errors, so it can never break authentication.
  databaseHooks: {
    session: {
      create: {
        after: async (session: { userId: string }) => {
          await logAudit({ userId: session.userId, action: "auth.login", entityType: "user", entityId: session.userId });
        },
      },
    },
  },
  // Social/OIDC providers (LINE custom-OIDC, Zalo OAuth2) are added in a later phase — see ADR-004.
});

export type Session = typeof auth.$Infer.Session;
