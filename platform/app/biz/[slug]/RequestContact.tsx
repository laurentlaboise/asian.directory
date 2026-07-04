"use client";

import { useState } from "react";

/** Consumer "request contact / quote" form on a business profile — generates a routed lead. */
export function RequestContact({ businessName, cityId }: { businessName: string; cityId: number | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const r = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: businessName,
        cityId: cityId ?? undefined,
        contactName: name,
        contactEmail: email,
        message: message || undefined,
      }),
    });
    setState(r.ok ? "done" : "error");
  }

  if (state === "done") {
    return <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">Request sent — the business will be in touch.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
      <h3 className="font-medium">Request contact</h3>
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="rounded border border-gray-300 px-3 py-2 text-sm" />
      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" className="rounded border border-gray-300 px-3 py-2 text-sm" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="What do you need? (optional)" className="rounded border border-gray-300 px-3 py-2 text-sm" />
      {state === "error" && <p className="text-sm text-red-600">Could not send — please try again.</p>}
      <button type="submit" disabled={state === "sending"} className="self-start rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50">
        {state === "sending" ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
