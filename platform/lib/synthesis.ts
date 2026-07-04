import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { primaryModel, fallbackModel } from "@/lib/llm";

/**
 * "Why Recommended" synthesis (spec §1.3). One grounded ≤15-word rationale per business,
 * generated in a SINGLE model call (not N calls). Strictly grounded: the model is given only
 * name/category/description and told not to invent facts. Degrades gracefully — on any model
 * error it returns [], so search results still render (just without rationales).
 */
const RationaleSchema = z.object({
  rationales: z.array(z.object({ id: z.string(), rationale: z.string().max(200) })),
});

export type Rationale = { id: string; rationale: string };
export type SynthInput = { id: string; name: string; category?: string | null; description?: string | null };

const SYSTEM =
  "For each business, explain in 15 words or fewer WHY it matches the user's search. " +
  "Use ONLY the provided name, category, and description. Never invent facts not present in the " +
  "data (no hours, prices, ratings, awards, or claims you can't see). No marketing fluff. " +
  "Return exactly one rationale for each business id provided; do not add or drop ids.";

async function runOn(model: LanguageModel, query: string, businesses: SynthInput[]): Promise<Rationale[]> {
  const { object } = await generateObject({
    model,
    schema: RationaleSchema,
    system: SYSTEM,
    prompt: JSON.stringify({ query, businesses }),
    maxTokens: 600,
    temperature: 0.2,
  });
  return object.rationales;
}

export async function synthesizeRationales(query: string, businesses: SynthInput[]): Promise<Rationale[]> {
  if (businesses.length === 0) return [];
  const allowed = new Set(businesses.map((b) => b.id));
  const clamp = (out: Rationale[]) =>
    out.filter((r) => allowed.has(r.id)).map((r) => ({ id: r.id, rationale: r.rationale.slice(0, 200) }));

  try {
    return clamp(await runOn(primaryModel(), query, businesses));
  } catch (err) {
    console.error("synthesis primary failed:", err);
    const fb = fallbackModel();
    if (fb) {
      try {
        return clamp(await runOn(fb, query, businesses));
      } catch (err2) {
        console.error("synthesis fallback failed:", err2);
      }
    }
    return [];
  }
}
