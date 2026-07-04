import { pool } from "@/lib/db";

/**
 * Append-only audit trail for security-relevant events (claims, lead actions, auth events).
 * Best-effort: a logging failure must never break the underlying operation, but it is surfaced
 * in server logs. Uses its own connection (not the caller's transaction) so an audit write can't
 * roll back the business action, and vice-versa.
 */
export async function logAudit(entry: {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
  ip?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `insert into audit_log (user_id, action, entity_type, entity_id, metadata, ip)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        entry.userId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ip ?? null,
      ],
    );
  } catch (err) {
    console.error("audit log write failed:", err);
  }
}
