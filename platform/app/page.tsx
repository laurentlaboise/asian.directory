"use client";

import { useState } from "react";

type Business = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  review_score: number;
  review_count: number;
  verification_tier: number;
};

export default function Home() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <header className="text-center">
        <h1 className="text-4xl font-bold">SEA Directory</h1>
        <p className="mt-2 text-gray-500">Find businesses in Southeast Asia by simply asking.</p>
      </header>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Find a good ramen spot in Vientiane"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          maxLength={300}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-yellow-400 px-5 py-3 font-medium text-gray-900 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-red-600">{error}</p>}

      {/* Results render as React text nodes — never innerHTML — so business content
          cannot inject markup/script. This closes the stored-XSS class by construction. */}
      <ul className="flex flex-col gap-3">
        {results.map((b) => (
          <li key={b.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-yellow-600">{b.name}</h2>
              {b.verification_tier >= 2 && (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Verified</span>
              )}
            </div>
            {b.description && <p className="mt-1 text-sm text-gray-600">{b.description}</p>}
            <p className="mt-2 text-xs text-gray-400">
              ★ {b.review_score.toFixed(1)} ({b.review_count})
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
