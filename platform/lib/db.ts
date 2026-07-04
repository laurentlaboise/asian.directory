import { Pool } from "pg";
import { env } from "./env";

/**
 * Single shared pg pool. Reused by Better Auth (identity tables) and the search API.
 *
 * SSL is explicit and never silently disables verification: `insecure` (rejectUnauthorized
 * false) is opt-in only and discouraged — the original audit flagged that anti-pattern.
 * Railway's private network typically needs no TLS (`off`); external connections use `require`.
 */
const ssl =
  env.DATABASE_SSL === "require"
    ? { rejectUnauthorized: true }
    : env.DATABASE_SSL === "insecure"
      ? { rejectUnauthorized: false }
      : false;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error:", err.message);
});
