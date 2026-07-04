import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/** Peppered hash of a 6-digit code. Salt = user+business so codes aren't cross-usable. */
function hashCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}:${env.BETTER_AUTH_SECRET}`).digest("hex");
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0"); // CSPRNG, uniform 000000-999999
}

/** Create (or replace) a challenge and return the plaintext code for delivery. */
export async function createChallenge(
  userId: string,
  businessId: string,
  channel: "email" | "phone",
  destination: string,
): Promise<string> {
  const code = generateCode();
  const salt = `${userId}:${businessId}`;
  // Invalidate any prior unconsumed challenge for this pair, then insert the new one.
  await pool.query(
    "update otp_challenges set consumed_at = now() where user_id = $1 and business_id = $2 and consumed_at is null",
    [userId, businessId],
  );
  await pool.query(
    `insert into otp_challenges (user_id, business_id, channel, destination, code_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
    [userId, businessId, channel, destination, hashCode(code, salt)],
  );
  return code;
}

type VerifyResult = { ok: true } | { ok: false; reason: "no_challenge" | "expired" | "too_many" | "mismatch" };

/** Verify a submitted code against the active challenge. Consumes it on success. */
export async function verifyChallenge(userId: string, businessId: string, code: string): Promise<VerifyResult> {
  const salt = `${userId}:${businessId}`;
  const r = await pool.query(
    `select id, code_hash, expires_at, attempts
     from otp_challenges
     where user_id = $1 and business_id = $2 and consumed_at is null
     order by created_at desc limit 1`,
    [userId, businessId],
  );
  if (r.rowCount === 0) return { ok: false, reason: "no_challenge" };

  const ch = r.rows[0];
  if (new Date(ch.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  // Atomically consume one attempt and enforce the cap in a single statement, so N concurrent
  // confirms can't all read the same count and slip past the 5-guess limit (TOCTOU).
  const inc = await pool.query(
    `update otp_challenges set attempts = attempts + 1 where id = $1 and attempts < $2 returning id`,
    [ch.id, MAX_ATTEMPTS],
  );
  if (inc.rowCount === 0) return { ok: false, reason: "too_many" };

  const expected = Buffer.from(ch.code_hash, "hex");
  const actual = Buffer.from(hashCode(code, salt), "hex");
  const match = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!match) return { ok: false, reason: "mismatch" };

  await pool.query("update otp_challenges set consumed_at = now() where id = $1", [ch.id]);
  return { ok: true };
}
