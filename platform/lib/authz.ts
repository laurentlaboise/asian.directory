import { pool } from "@/lib/db";
import { getSessionUser, getRole } from "@/lib/session";

/**
 * Authorization guards — the real server-side boundary (SEC-7). Every protected route calls one
 * of these and returns the guard's status on failure, so authz is never left to the client or
 * to the optimistic middleware redirect.
 */
type Deny = { ok: false; status: 401 | 403 | 404; error: string };

/** Require an authenticated user with one of `roles`. */
export async function requireRole(
  headers: Headers,
  ...roles: string[]
): Promise<Deny | { ok: true; user: { id: string; email?: string | null }; role: string }> {
  const user = await getSessionUser(headers);
  if (!user) return { ok: false, status: 401, error: "Authentication required" };
  const role = await getRole(user.id);
  if (!roles.includes(role)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, user, role };
}

/**
 * Require that the caller owns `businessId` (or is an admin). Single source of truth for the
 * "can this user mutate this business" decision — used by edit, verification, etc.
 */
export async function requireBusinessAccess(
  headers: Headers,
  businessId: string,
): Promise<Deny | { ok: true; user: { id: string; email?: string | null }; role: string; ownerId: string | null }> {
  const user = await getSessionUser(headers);
  if (!user) return { ok: false, status: 401, error: "Authentication required" };

  const r = await pool.query("select owner_id from businesses where id = $1", [businessId]);
  if (r.rowCount === 0) return { ok: false, status: 404, error: "Business not found" };

  const ownerId: string | null = r.rows[0].owner_id;
  const role = await getRole(user.id);
  if (ownerId !== user.id && role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, user, role, ownerId };
}
