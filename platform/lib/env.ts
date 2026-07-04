import { z } from "zod";

/**
 * Fail-closed environment validation.
 *
 * Directly prevents the #1 finding from the original asian.directory audit
 * (hardcoded secret fallback): there is NO default for any secret. If a required
 * variable is missing or malformed, the process throws at import time and refuses
 * to serve traffic, in every environment.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(["off", "require", "insecure"]).default("off"),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be >= 32 chars"),
  BETTER_AUTH_URL: z.string().url(),
  // Public origin for canonical/SEO URLs (falls back to BETTER_AUTH_URL if unset).
  SITE_URL: z.string().url().optional(),

  EMBEDDINGS_URL: z.string().url(),
  EMBEDDINGS_API_KEY: z.string().optional(),

  // Below this fused RRF score the top result is treated as a weak match -> confidence fallback.
  // Scale note: with rrf_k=50, score maxes at ~0.039 (rank-1 in BOTH lists); rank-1 in a single
  // list is ~0.0196. Default sits just under single-list rank-1 so genuine one-modality hits are
  // NOT flagged. Heuristic — tune against real data once the corpus is populated.
  SEARCH_CONFIDENCE_MIN: z.coerce.number().default(0.01),

  LLM_PRIMARY: z.enum(["anthropic", "google"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  SEALION_BASE_URL: z.string().url().optional(),
  SEALION_API_KEY: z.string().optional(),

  // Email sender for OTP delivery (Phase 2 verification). Optional in dev (codes are logged);
  // required in production or Tier-1 verification fails closed.
  MAIL_FROM: z.string().email().optional(),

  // Phase 3 lead routing / monetization (ADR-005). Overridable without code changes.
  CRON_SECRET: z.string().min(16).optional(),          // gates /api/cron/* (required to call it)
  LEAD_DIRECT_MATCH_THRESHOLD: z.coerce.number().default(75), // >= => direct route to top business
  LEAD_DIRECT_CREDIT_COST: z.coerce.number().int().default(3),
  LEAD_POOL_CREDIT_COST: z.coerce.number().int().default(1),
  LEAD_TTL_HOURS: z.coerce.number().int().default(24),
  LEAD_POOL_SIZE: z.coerce.number().int().default(5),
  // Model ids kept in config so they can be bumped without a code change.
  LLM_ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  LLM_GOOGLE_MODEL: z.string().default("gemini-2.5-flash"),
  LLM_SEALION_MODEL: z.string().default("aisingapore/Gemma-SEA-LION-v4-27B-IT"),
});

type Env = z.infer<typeof schema>;

// Next.js imports route modules during `next build` to collect metadata. We don't want the
// build to fail just because runtime secrets aren't present in the build environment, so the
// hard fail-closed check is skipped ONLY during the build phase. At runtime it always enforces.
const buildPhase = process.env.NEXT_PHASE === "phase-production-build";
const parsed = schema.safeParse(process.env);

if (!parsed.success && !buildPhase) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid or missing environment variables — refusing to boot.");
}

const data = (parsed.success ? parsed.data : {}) as Env;

// Enforce that the chosen primary LLM actually has a key (fail closed, not at first request).
if (!buildPhase) {
  if (data.LLM_PRIMARY === "anthropic" && !data.ANTHROPIC_API_KEY) {
    throw new Error("LLM_PRIMARY=anthropic but ANTHROPIC_API_KEY is missing.");
  }
  if (data.LLM_PRIMARY === "google" && !data.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("LLM_PRIMARY=google but GOOGLE_GENERATIVE_AI_API_KEY is missing.");
  }
}

export const env = data;
