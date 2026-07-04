#!/usr/bin/env node
// =============================================================================
// boot-check.mjs — live smoke test for the SEA Directory platform.
//
// Verifies a running instance end-to-end: DB-backed health, hybrid search
// (with a hard DEDUP assertion — one row per business), rate limiting, and one
// programmatic-SEO page (200 + JSON-LD). No dependencies (Node 18+ fetch).
//
// Usage:
//   BASE_URL=https://your-app.up.railway.app node scripts/boot-check.mjs
//   node scripts/boot-check.mjs http://localhost:3000
//   BASE_URL=... SEARCH_Q="ramen in vientiane" SEO_PATH="/vientiane/restaurant" node scripts/boot-check.mjs
//
// Exit code 0 = all checks passed; 1 = at least one failed. Prints a summary.
// =============================================================================

const BASE_URL = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SEARCH_Q = process.env.SEARCH_Q || "restaurant in vientiane";
const SEO_PATH = process.env.SEO_PATH || "/vientiane/restaurant";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON (e.g. HTML page) */ }
    return { res, text, json };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// 1. Health — DB reachable
// ---------------------------------------------------------------------------
async function checkHealth() {
  try {
    const { res, json } = await req("/api/health");
    const ok = res.status === 200 && json?.status === "ok";
    record("health: /api/health returns 200 + status:ok", ok,
      ok ? null : `got ${res.status} ${JSON.stringify(json)}`);
  } catch (e) {
    record("health: /api/health returns 200 + status:ok", false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 2. Search — 200, well-formed, and DEDUPLICATED (the key regression guard:
//    business_embeddings has up to 4 rows/business; hybrid_search must collapse them)
// ---------------------------------------------------------------------------
async function checkSearch() {
  let rows;
  try {
    const { res, json } = await req("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: SEARCH_Q }),
    });
    if (res.status !== 200) {
      record("search: POST /api/search returns 200", false, `got ${res.status}`);
      return;
    }
    record("search: POST /api/search returns 200", true, null);

    rows = json?.results;
    const shapeOk = Array.isArray(rows) && typeof json?.lowConfidence === "boolean";
    record("search: response shape { results:[], lowConfidence:bool }", shapeOk,
      shapeOk ? `${rows.length} result(s), lowConfidence=${json.lowConfidence}` : JSON.stringify(json)?.slice(0, 160));
    if (!shapeOk) return;
  } catch (e) {
    record("search: POST /api/search returns 200", false, e.message);
    return;
  }

  // Hard dedup assertion — the whole point of the 0001/0003 distinct-on fix.
  const ids = rows.map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  record("search: results are deduplicated (no repeated business id)", dupes.length === 0,
    dupes.length ? `duplicate id(s): ${[...new Set(dupes)].join(", ")}` : `${ids.length} unique`);

  // Each row should carry a numeric fused score (confidence signal).
  if (rows.length) {
    const scored = rows.every((r) => typeof r.score === "number");
    record("search: every result has a numeric fused score", scored,
      scored ? `top score=${rows[0].score}` : "missing/NaN score");
  } else {
    record("search: (skipped score check — 0 results; seed the DB to exercise fully)", true, null);
  }
}

// ---------------------------------------------------------------------------
// 3. Rate limiting — the search limiter is 30/min per IP; a burst must 429.
//    (From one host the IP is stable, so >30 rapid calls should trip it.)
// ---------------------------------------------------------------------------
async function checkRateLimit() {
  try {
    const burst = 35;
    let got429 = false;
    let retryAfter = null;
    for (let i = 0; i < burst; i++) {
      const { res } = await req("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: SEARCH_Q }),
      });
      if (res.status === 429) {
        got429 = true;
        retryAfter = res.headers.get("retry-after");
        break;
      }
    }
    record("rate-limit: search burst (>30/min) yields 429", got429,
      got429 ? `Retry-After=${retryAfter ?? "n/a"}` : `no 429 in ${burst} calls (is a proxy rewriting the IP, or limiter shared across replicas?)`);
  } catch (e) {
    record("rate-limit: search burst (>30/min) yields 429", false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 4. Programmatic SEO page — 200 (or a clean 404 if unseeded) + JSON-LD present
// ---------------------------------------------------------------------------
async function checkSeoPage() {
  try {
    const { res, text } = await req(SEO_PATH);
    if (res.status === 404) {
      record(`seo: ${SEO_PATH} (thin-content 404 — expected until seeded)`, true,
        "route returns 404 with no businesses; seed to get a 200 page");
      return;
    }
    const ok200 = res.status === 200;
    record(`seo: ${SEO_PATH} returns 200`, ok200, ok200 ? null : `got ${res.status}`);
    if (!ok200) return;
    const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(text);
    record("seo: page includes JSON-LD structured data", hasJsonLd,
      hasJsonLd ? null : "no application/ld+json script tag found");
  } catch (e) {
    record(`seo: ${SEO_PATH} returns 200`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nBoot check against ${BASE_URL}\n`);
  console.log("Health");
  await checkHealth();
  console.log("Search");
  await checkSearch();
  console.log("Rate limiting");
  await checkRateLimit();
  console.log("Programmatic SEO");
  await checkSeoPage();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    console.log("");
    process.exit(1);
  }
  console.log("\x1b[32mAll checks passed.\x1b[0m\n");
}

main().catch((e) => {
  console.error("boot-check crashed:", e);
  process.exit(1);
});
