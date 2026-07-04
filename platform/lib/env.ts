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

  EMBEDDINGS_URL: z.string().url(),
  EMBEDDINGS_API_KEY: z.string().optional(),

  LLM_PRIMARY: z.enum(["anthropic", "google"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  SEALION_BASE_URL: z.string().url().optional(),
  SEALION_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid or missing environment variables — refusing to boot.");
}

// Enforce that the chosen primary LLM actually has a key (fail closed, not at first request).
if (parsed.data.LLM_PRIMARY === "anthropic" && !parsed.data.ANTHROPIC_API_KEY) {
  throw new Error("LLM_PRIMARY=anthropic but ANTHROPIC_API_KEY is missing.");
}
if (parsed.data.LLM_PRIMARY === "google" && !parsed.data.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("LLM_PRIMARY=google but GOOGLE_GENERATIVE_AI_API_KEY is missing.");
}

export const env = parsed.data;
