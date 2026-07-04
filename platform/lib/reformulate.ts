import { generateText } from "ai";
import { primaryModel } from "@/lib/llm";

/**
 * Multi-turn: rewrite a follow-up ("cheaper options?", "which are family-friendly?") plus recent
 * history into a single standalone search query. Graceful — on any failure it returns the raw
 * query, so multi-turn never breaks single-turn search.
 */
export async function reformulateQuery(q: string, history: string[]): Promise<string> {
  if (history.length === 0) return q;
  try {
    const { text } = await generateText({
      model: primaryModel(),
      system:
        "Rewrite the user's latest message into ONE standalone local-business search query, " +
        "merging relevant context (place, category, constraints) from the prior messages. " +
        "Output only the query text — no quotes, no explanation.",
      prompt: JSON.stringify({ history: history.slice(-4), latest: q }),
      maxTokens: 60,
      temperature: 0,
    });
    const out = text.trim();
    return out.length >= 2 && out.length <= 300 ? out : q;
  } catch (err) {
    console.error("reformulate failed:", err);
    return q;
  }
}
