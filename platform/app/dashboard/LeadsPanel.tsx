"use client";

import { useEffect, useState, useCallback } from "react";

type Lead = {
  lead_id: string;
  service_requested: string;
  budget_hint: string;
  lead_status: string;
  intent_score: number;
  created_at: string;
  expires_at: string | null;
  business_id: string;
  business_name: string;
  interaction_status: string;
  credit_cost: number;
  contact_name: string | null;
  contact_email: string | null;
  message: string | null;
};

export function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/merchant/leads");
    if (r.ok) setLeads((await r.json()).leads);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function claim(lead: Lead) {
    setMsg(null);
    const r = await fetch(`/api/leads/${lead.lead_id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: lead.business_id }),
    });
    const d = await r.json();
    setMsg(r.ok ? `Claimed for ${d.creditsCharged} credit(s) — contact: ${d.contact.email}` : d.error);
    void load();
  }

  async function outcome(lead: Lead, o: "won" | "lost") {
    await fetch(`/api/leads/${lead.lead_id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: lead.business_id, outcome: o }),
    });
    void load();
  }

  if (leads.length === 0) return <p className="text-sm text-gray-500">No leads yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
      {leads.map((lead) => (
        <div key={`${lead.lead_id}:${lead.business_id}`} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{lead.service_requested}</span>
            <span className="text-xs text-gray-400">score {lead.intent_score} · {lead.credit_cost} credit(s)</span>
          </div>
          <p className="text-xs text-gray-500">
            {lead.business_name} · budget {lead.budget_hint} · {lead.interaction_status}
          </p>

          {lead.interaction_status === "accepted" ? (
            <div className="mt-2 rounded bg-gray-50 p-2">
              <p className="font-medium">{lead.contact_name} — {lead.contact_email}</p>
              {lead.message && <p className="text-gray-600">{lead.message}</p>}
              {lead.lead_status === "claimed" && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => outcome(lead, "won")} className="rounded bg-green-500 px-3 py-1 text-xs text-white">Mark won</button>
                  <button onClick={() => outcome(lead, "lost")} className="rounded bg-gray-300 px-3 py-1 text-xs">Mark lost</button>
                </div>
              )}
            </div>
          ) : lead.interaction_status === "sent" && !["claimed", "expired", "won", "lost"].includes(lead.lead_status) ? (
            <button onClick={() => claim(lead)} className="mt-2 rounded-lg bg-yellow-400 px-3 py-1 text-xs font-medium text-gray-900">
              Claim ({lead.credit_cost} credit{lead.credit_cost === 1 ? "" : "s"})
            </button>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Closed</p>
          )}
        </div>
      ))}
    </div>
  );
}
