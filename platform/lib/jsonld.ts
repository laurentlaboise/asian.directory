/**
 * Serialize JSON-LD for embedding in a <script type="application/ld+json"> tag.
 *
 * Escapes `<` so a data-derived string (e.g. a business name containing "</script>") cannot
 * break out of the script element — the standard, safe way to inject JSON-LD. This is the ONLY
 * sanctioned use of dangerouslySetInnerHTML in the app: non-executable data, escaped + nonce'd.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
