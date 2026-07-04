import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "./env";

/**
 * LLM providers (ADR-003).
 *  - Primary: Claude (Sonnet-class) or Gemini — real SLA, safety alignment, streaming.
 *  - Fallback: self-hosted SEA-LION (OpenAI-compatible) for SEA-language edge cases.
 *
 * Model ids are defaults; override per environment as newer versions ship.
 */
const sealion = env.SEALION_BASE_URL
  ? createOpenAICompatible({
      name: "sealion",
      baseURL: env.SEALION_BASE_URL,
      apiKey: env.SEALION_API_KEY ?? "",
    })
  : null;

export function primaryModel(): LanguageModel {
  return env.LLM_PRIMARY === "google"
    ? google(env.LLM_GOOGLE_MODEL)
    : anthropic(env.LLM_ANTHROPIC_MODEL);
}

/** SEA-language specialist fallback; null if not configured. */
export function fallbackModel(): LanguageModel | null {
  // Reasoning ("-R") default OFF for synthesis — see ADR-003 latency/cost note.
  return sealion ? sealion(env.LLM_SEALION_MODEL) : null;
}
