import { streamText } from "ai";
import { z } from "zod";
import { primaryModel } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  q: z.string().trim().min(2).max(300),
  count: z.number().int().min(0).max(30),
  lowConfidence: z.boolean().default(false),
});

/**
 * Streams a one-sentence conversational lead-in for the results (perceived-latency win, spec §3.1).
 * Uses only a stable AI SDK primitive (`toTextStreamResponse`) — the structured Rich Cards travel
 * separately as JSON, so there's no fragile streaming-data protocol to break.
 *
 * Confidence fallback (spec §1.3): when the retrieval score is below threshold, the model is told
 * to state the limitation honestly rather than oversell a weak match.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`assist:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response("Invalid request", { status: 400 });
  }

  const system =
    input.lowConfidence || input.count === 0
      ? "You are a local-business search assistant. The search did not find a strong match. In ONE short, honest sentence tell the user you couldn't find a strong match and, if any results exist, that these are the closest options. Never invent businesses or details."
      : "You are a local-business search assistant. In ONE short, friendly sentence, introduce the businesses found for the user's query. Do not list them or invent any details.";

  const result = streamText({
    model: primaryModel(),
    system,
    prompt: JSON.stringify({ query: input.q, resultCount: input.count }),
    maxTokens: 80,
    temperature: 0.4,
  });

  return result.toTextStreamResponse();
}
