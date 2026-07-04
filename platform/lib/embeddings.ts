import { env } from "./env";

const DIM = 1024; // BGE-M3 dense (ADR-001). Must match businesses embedding vector(1024).

/**
 * Embed a query with the self-hosted BGE-M3 endpoint. Returns a unit-normalized 1024-vector.
 * Validates the dimension so a misconfigured model can never silently poison the index.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${env.EMBEDDINGS_URL}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.EMBEDDINGS_API_KEY ? { Authorization: `Bearer ${env.EMBEDDINGS_API_KEY}` } : {}),
    },
    body: JSON.stringify({ input: text, normalize: true }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Embeddings service returned ${res.status}`);

  const data: unknown = await res.json();
  const vec =
    (data as { embedding?: number[] }).embedding ??
    (data as { data?: { embedding: number[] }[] }).data?.[0]?.embedding;

  if (!Array.isArray(vec) || vec.length !== DIM) {
    throw new Error(`Expected ${DIM}-dim embedding, got ${Array.isArray(vec) ? vec.length : "none"}`);
  }
  return vec;
}

/** Alias for embedding passages/documents at ingest time. BGE-M3 needs no query/passage prefix. */
export const embedText = embedQuery;

/** pgvector text literal for a parameterized `$n::vector` bind. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
