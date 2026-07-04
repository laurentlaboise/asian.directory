"use client";

import { useCallback, useEffect, useState } from "react";

type Submission = {
  id: string;
  business_name: string;
  tier_requested: number;
  kind: string;
  evidence_url: string;
  note: string | null;
};
type Review = {
  id: string;
  business_name: string;
  rating: number;
  body: string | null;
  flagged: boolean;
  flag_reason: string | null;
};

export function AdminPanels() {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  const load = useCallback(async () => {
    const [v, r] = await Promise.all([fetch("/api/admin/verifications"), fetch("/api/admin/reviews")]);
    if (v.ok) setSubs((await v.json()).submissions);
    if (r.ok) setReviews((await r.json()).reviews);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decideSub(id: string, action: "approve" | "reject") {
    await fetch(`/api/admin/verifications/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    void load();
  }
  async function decideReview(id: string, action: "approve" | "reject") {
    await fetch(`/api/admin/reviews/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    void load();
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Verification submissions ({subs.length})</h2>
        {subs.length === 0 && <p className="text-sm text-gray-500">Nothing pending.</p>}
        {subs.map((s) => (
          <div key={s.id} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <p className="font-medium">{s.business_name} — Tier {s.tier_requested} ({s.kind})</p>
            <a href={s.evidence_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">evidence</a>
            {s.note && <p className="text-gray-600">{s.note}</p>}
            <div className="mt-2 flex gap-2">
              <button onClick={() => decideSub(s.id, "approve")} className="rounded bg-green-500 px-3 py-1 text-xs text-white">Approve</button>
              <button onClick={() => decideSub(s.id, "reject")} className="rounded bg-gray-300 px-3 py-1 text-xs">Reject</button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Pending reviews ({reviews.length})</h2>
        {reviews.length === 0 && <p className="text-sm text-gray-500">Nothing pending.</p>}
        {reviews.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <p className="font-medium">
              {r.business_name} — {r.rating}/5 {r.flagged && <span className="text-red-600">⚑ {r.flag_reason}</span>}
            </p>
            {r.body && <p className="text-gray-700">{r.body}</p>}
            <div className="mt-2 flex gap-2">
              <button onClick={() => decideReview(r.id, "approve")} className="rounded bg-green-500 px-3 py-1 text-xs text-white">Publish</button>
              <button onClick={() => decideReview(r.id, "reject")} className="rounded bg-gray-300 px-3 py-1 text-xs">Reject</button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
