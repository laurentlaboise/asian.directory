"use client";

import { useRef, useState } from "react";

type Business = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  review_score: number;
  review_count: number;
  verification_tier: number;
};

type Turn = {
  role: "user" | "assistant";
  text: string;
  results?: Business[];
  rationales?: Record<string, string>;
  lowConfidence?: boolean;
};

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const busyRef = useRef(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    // Synchronous ref guard: `busy` state lags a render, so two fast submits could both pass.
    if (query.length < 2 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setQ("");

    const history = turnsRef.current.filter((t) => t.role === "user").map((t) => t.text);
    // Capture THIS turn's assistant index so callbacks never write into a later turn.
    const assistantIndex = turnsRef.current.length + 1;
    setTurns((t) => [...t, { role: "user", text: query }, { role: "assistant", text: "" }]);

    try {
      // 1) Retrieve (with multi-turn history) — returns results + confidence.
      const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, history }),
      });
      const search = await searchRes.json();
      if (!searchRes.ok) throw new Error(search.error ?? "Search failed");
      const results: Business[] = search.results ?? [];
      const usedQuery: string = search.query ?? query;
      const lowConfidence: boolean = !!search.lowConfidence;

      // 2) In parallel: stream the lead-in, and fetch grounded rationales.
      const rationalesP = results.length
        ? fetch("/api/synthesis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q: usedQuery, ids: results.map((r) => r.id) }),
          })
            .then((r) => (r.ok ? r.json() : { rationales: [] }))
            .then((d: { rationales: { id: string; rationale: string }[] }) =>
              Object.fromEntries(d.rationales.map((x) => [x.id, x.rationale])),
            )
            .catch(() => ({}))
        : Promise.resolve({});

      // attach cards immediately so they render while the sentence streams
      setTurns((t) => {
        const next = [...t];
        next[assistantIndex] = { role: "assistant", text: "", results, lowConfidence };
        return next;
      });

      const streamP = streamAssistant(query, results.length, lowConfidence, (chunk) => {
        setTurns((t) => {
          const next = [...t];
          const last = next[assistantIndex]!;
          next[assistantIndex] = { ...last, text: last.text + chunk };
          return next;
        });
      });

      const [rationales] = await Promise.all([rationalesP, streamP]);
      setTurns((t) => {
        const next = [...t];
        const last = next[assistantIndex]!;
        next[assistantIndex] = { ...last, rationales: rationales as Record<string, string> };
        return next;
      });
    } catch (err) {
      setTurns((t) => {
        const next = [...t];
        next[assistantIndex] = {
          role: "assistant",
          text: err instanceof Error ? err.message : "Something went wrong.",
        };
        return next;
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold">SEA Directory</h1>
        <p className="mt-1 text-sm text-gray-500">Find businesses in Southeast Asia by simply asking.</p>
      </header>

      <div className="flex flex-1 flex-col gap-6">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="self-end rounded-2xl bg-yellow-400 px-4 py-2 text-gray-900">
              {turn.text}
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-3">
              <p className="text-gray-700">{turn.text || <span className="text-gray-400">…</span>}</p>
              {turn.results && turn.results.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {turn.results.map((b) => (
                    <article key={b.id} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex items-center justify-between">
                        <h2 className="font-semibold text-yellow-600">{b.name}</h2>
                        {b.verification_tier >= 2 && (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Verified</span>
                        )}
                      </div>
                      {turn.rationales?.[b.id] && (
                        <p className="mt-1 text-sm italic text-gray-500">“{turn.rationales[b.id]}”</p>
                      )}
                      {b.description && <p className="mt-1 text-sm text-gray-600">{b.description}</p>}
                      <p className="mt-2 text-xs text-gray-400">
                        ★ {b.review_score.toFixed(1)} ({b.review_count})
                      </p>
                    </article>
                  ))}
                </div>
              )}
              {turn.results && turn.results.length === 0 && (
                <p className="text-sm text-gray-400">No matching businesses yet.</p>
              )}
            </div>
          ),
        )}
      </div>

      <form onSubmit={ask} className="sticky bottom-4 flex gap-2 bg-gray-50 pt-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Find a good ramen spot in Vientiane"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          maxLength={300}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-yellow-400 px-5 py-3 font-medium text-gray-900 disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </main>
  );
}

/** Read the streamed lead-in sentence token-by-token from /api/assistant. */
async function streamAssistant(
  q: string,
  count: number,
  lowConfidence: boolean,
  onChunk: (s: string) => void,
): Promise<void> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, count, lowConfidence }),
  });
  if (!res.ok || !res.body) {
    onChunk(count > 0 ? "Here's what I found:" : "I couldn't find a strong match.");
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode(); // flush any trailing multibyte (CJK/Lao) sequence
  if (tail) onChunk(tail);
}
