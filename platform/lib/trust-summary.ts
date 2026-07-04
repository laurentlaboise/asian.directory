import { generateText } from "ai";
import { pool } from "@/lib/db";
import { primaryModel } from "@/lib/llm";

/**
 * Semantic Trust Summary (spec §3.2): one balanced sentence synthesized from a business's PUBLISHED
 * reviews and cached on the row. Strictly grounded in the retrieved reviews to avoid hallucination;
 * regenerated (best-effort) whenever a review is published. Never throws to its caller.
 */
export async function generateTrustSummary(businessId: string): Promise<void> {
  try {
    const r = await pool.query(
      "select rating, body from reviews where business_id = $1 and status = 'published' order by created_at desc limit 50",
      [businessId],
    );
    if (r.rowCount === 0) {
      await pool.query("update businesses set trust_summary = null, trust_summary_at = now() where id = $1", [businessId]);
      return;
    }
    const corpus = r.rows
      .map((x: { rating: number; body: string | null }) => `(${x.rating}/5) ${x.body ?? ""}`)
      .join("\n")
      .slice(0, 6000);

    const { text } = await generateText({
      model: primaryModel(),
      temperature: 0.2,
      maxTokens: 120,
      prompt:
        `Summarize these customer reviews into ONE balanced sentence (max 30 words) a shopper can ` +
        `trust. Name a common praise and, if clearly present, a common concern. Use ONLY what the ` +
        `reviews say — do not invent details.\n\nReviews:\n${corpus}`,
    });
    await pool.query("update businesses set trust_summary = $2, trust_summary_at = now() where id = $1", [
      businessId,
      text.trim().slice(0, 500),
    ]);
  } catch (err) {
    console.error("trust summary generation failed (non-fatal):", err);
  }
}
