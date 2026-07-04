/**
 * Minimal fixed-window rate limiter (in-memory).
 *
 * MVP-scoped: state lives in one process, so it does not coordinate across multiple
 * Railway replicas — swap for a Redis/Upstash-backed limiter before horizontal scaling.
 * Documented here rather than left as a silent gap.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow unbounded.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (now > b.resetAt) buckets.delete(key);
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, remaining: limit - 1 };
  }
  if (b.count >= limit) {
    return { ok: false as const, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true as const, remaining: limit - b.count };
}

/**
 * Client IP from the proxy chain. Railway sets X-Forwarded-For; take the left-most entry.
 * (The original backend never configured trust-proxy, so its rate limiting and audit IPs
 * were wrong — here the IP source is explicit.)
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
