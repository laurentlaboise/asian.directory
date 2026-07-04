import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

/**
 * Server-side session + role helpers. THIS is the real authorization boundary (the middleware
 * is only an optimistic redirect). Every protected route must call requireUser()/requireRole()
 * — never trust the client or a cookie's mere presence. (SEC-7.)
 */
export async function getSessionUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}

/** Returns the authenticated user or null. */
export async function requireUser(headers: Headers) {
  return getSessionUser(headers);
}

/** Application role from `profiles` (defaults to viewer if no row yet). */
export async function getRole(userId: string): Promise<string> {
  const r = await pool.query("select role from profiles where user_id = $1", [userId]);
  return r.rows[0]?.role ?? "viewer";
}

/** True if the user's role is in the allowed set. */
export async function hasRole(userId: string, ...roles: string[]): Promise<boolean> {
  return roles.includes(await getRole(userId));
}
