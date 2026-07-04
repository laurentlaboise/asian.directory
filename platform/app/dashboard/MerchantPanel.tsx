"use client";

import { useState } from "react";

export type MerchantBusiness = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  verification_tier: number;
  review_score: number;
  review_count: number;
};

const TIER_LABEL: Record<number, string> = {
  0: "Unverified",
  1: "Verified contact",
  2: "Community endorsed",
  3: "Institutionally verified",
};

export function MerchantPanel({ business }: { business: MerchantBusiness }) {
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description ?? "");
  const [phone, setPhone] = useState(business.phone ?? "");
  const [website, setWebsite] = useState(business.website ?? "");
  const [tier, setTier] = useState(business.verification_tier);
  const [status, setStatus] = useState<string | null>(null);

  // Tier-1 verification state
  const [otpStage, setOtpStage] = useState<"idle" | "sent">("idle");
  const [code, setCode] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(`/api/businesses/${business.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, phone: phone || null, website: website || null }),
    });
    setStatus(res.ok ? "Saved." : (await res.json()).error ?? "Save failed");
  }

  async function startVerify() {
    setStatus(null);
    const res = await fetch(`/api/businesses/${business.id}/verify/start`, { method: "POST" });
    const data = await res.json();
    if (res.ok) { setOtpStage("sent"); setStatus(`Code sent to ${data.sentTo}`); }
    else setStatus(data.error ?? "Could not send code");
  }

  async function confirmVerify() {
    setStatus(null);
    const res = await fetch(`/api/businesses/${business.id}/verify/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (res.ok) { setTier(Math.max(tier, 1)); setOtpStage("idle"); setCode(""); setStatus("Verified!"); }
    else setStatus(data.error ?? "Verification failed");
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{business.name}</h2>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
          {TIER_LABEL[tier] ?? `Tier ${tier}`}
        </span>
      </div>

      <form onSubmit={save} className="flex flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-gray-300 px-3 py-2" placeholder="Name" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="rounded border border-gray-300 px-3 py-2" placeholder="Description" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded border border-gray-300 px-3 py-2" placeholder="Phone" />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} className="rounded border border-gray-300 px-3 py-2" placeholder="Website (https://…)" />
        <button type="submit" className="self-start rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900">Save changes</button>
      </form>

      {tier < 1 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {otpStage === "idle" ? (
            <button onClick={startVerify} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              Verify contact (Tier 1)
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit code" className="w-32 rounded border border-gray-300 px-3 py-2" />
              <button onClick={confirmVerify} className="rounded-lg bg-yellow-400 px-3 py-2 text-sm font-medium text-gray-900">Confirm</button>
            </div>
          )}
        </div>
      )}

      {status && <p className="mt-3 text-sm text-gray-600">{status}</p>}
    </section>
  );
}
