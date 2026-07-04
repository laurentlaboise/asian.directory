/**
 * Lightweight review screening (Phase 2 stub). The spec's transformer-based fake-review
 * detection (RoBERTa/DistilBERT + behavioral anomaly signals) lands later; this catches the
 * obvious spam classes so flagged reviews can be held for moderation rather than auto-published.
 */
export function screenReview(body: string | null): { flagged: boolean; reason?: string } {
  if (!body) return { flagged: false };
  const text = body.trim();
  if (/(https?:\/\/|www\.)/i.test(text)) return { flagged: true, reason: "contains_link" };
  if (/(.)\1{6,}/.test(text)) return { flagged: true, reason: "repeated_chars" };
  if (text.length < 10) return { flagged: true, reason: "too_short" };
  return { flagged: false };
}
