import { generateObject } from "ai";
import { z } from "zod";
import { primaryModel } from "@/lib/llm";

/**
 * Intent classification (spec §1.2). Turns a free-text query into structured commercial signals
 * that feed the lead-scoring engine. LLM-backed with a deterministic heuristic fallback so lead
 * capture never hard-fails on an LLM outage.
 */
const IntentSchema = z.object({
  service_requested: z.string().max(120),
  budget_hint: z.enum(["low", "medium", "high", "unknown"]),
  urgency: z.enum(["immediate", "soon", "exploratory"]),
  intent_strength: z.number().int().min(0).max(40),
});
export type Intent = z.infer<typeof IntentSchema>;

export async function classifyIntent(query: string): Promise<Intent> {
  try {
    const { object } = await generateObject({
      model: primaryModel(),
      schema: IntentSchema,
      temperature: 0,
      maxTokens: 200,
      prompt:
        `Extract commercial intent from this Southeast-Asian local-business search query.\n` +
        `- service_requested: the concrete service/category sought.\n` +
        `- budget_hint: low/medium/high/unknown from price cues.\n` +
        `- urgency: immediate (needs it now/today), soon (this week/quote), or exploratory.\n` +
        `- intent_strength 0-40: 40 = explicit immediate need with budget; 0 = idle browsing.\n\n` +
        `Query: "${query}"`,
    });
    return object;
  } catch (err) {
    console.error("intent LLM classify failed, using heuristic:", err);
    return heuristicIntent(query);
  }
}

function heuristicIntent(query: string): Intent {
  const q = query.toLowerCase();
  const immediate = /(today|now|urgent|emergency|asap|tonight|right away)/.test(q);
  const soon = /(this week|tomorrow|soon|quote|price|book|appointment)/.test(q);
  const budget_hint: Intent["budget_hint"] = /(cheap|budget|affordable|discount|lowest)/.test(q)
    ? "low"
    : /(premium|best|luxury|high[- ]end)/.test(q)
      ? "high"
      : "unknown";
  return {
    service_requested: query.slice(0, 120),
    budget_hint,
    urgency: immediate ? "immediate" : soon ? "soon" : "exploratory",
    intent_strength: immediate ? 34 : soon ? 22 : 12,
  };
}
