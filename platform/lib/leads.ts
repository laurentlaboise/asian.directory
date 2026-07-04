import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { classifyIntent } from "@/lib/intent";
import {
  haversineKm,
  proximityScore,
  responsivenessScore,
  totalScore,
  verificationScore,
} from "@/lib/lead-scoring";

export type LeadInput = {
  query: string;
  sessionId: string;
  cityId?: number | null;
  geoLat?: number | null;
  geoLng?: number | null;
  contactName: string;
  contactEmail: string;
  message?: string | null;
};

export type RouteResult =
  | { routed: false; leadId: string }
  | { routed: true; leadId: string; mode: "direct" | "pool"; businessCount: number };

/**
 * Create a lead, score candidate businesses, and route it (spec §2). Credits are NOT charged
 * here — pay-per-lead means a business pays only when it CLAIMS (accepts) the lead. The price is
 * recorded on each lead_interaction; claimLead() deducts it atomically.
 */
export async function createAndRoute(input: LeadInput): Promise<RouteResult> {
  const intent = await classifyIntent(input.query);

  // Candidate businesses: active, in-city (if known), lexically matching the service, best-trust first.
  const candidates = (
    await pool.query(
      `select b.id, b.verification_tier, b.lat, b.lng,
              (select avg(extract(epoch from (li.responded_at - li.created_at)) / 60)
                 from lead_interactions li
                where li.business_id = b.id and li.responded_at is not null) as avg_resp_min
       from businesses b
       where b.status = 'active'
         and ($1::int is null or b.city_id = $1)
         and b.search_doc &@~ $2
       order by b.verification_tier desc, b.review_score desc
       limit $3`,
      [input.cityId ?? null, intent.service_requested, env.LEAD_POOL_SIZE],
    )
  ).rows as { id: string; verification_tier: number; lat: number | null; lng: number | null; avg_resp_min: number | null }[];

  const scored = candidates
    .map((c) => ({
      id: c.id,
      score: totalScore({
        intentStrength: intent.intent_strength,
        proximity: proximityScore(haversineKm(input.geoLat ?? null, input.geoLng ?? null, c.lat, c.lng)),
        verification: verificationScore(c.verification_tier),
        responsiveness: responsivenessScore(c.avg_resp_min == null ? null : Number(c.avg_resp_min)),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const client = await pool.connect();
  try {
    await client.query("begin");

    const leadRow = await client.query(
      `insert into leads (query_session_id, intent_score, service_requested, budget_hint,
                          geo_lat, geo_lng, city_id, contact_name, contact_email, message,
                          matched_business_id, status, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(hours => $13))
       returning id`,
      [
        input.sessionId,
        top?.score ?? intent.intent_strength,
        intent.service_requested,
        intent.budget_hint,
        input.geoLat ?? null,
        input.geoLng ?? null,
        input.cityId ?? null,
        input.contactName,
        input.contactEmail,
        input.message ?? null,
        top?.id ?? null,
        top ? (top.score >= env.LEAD_DIRECT_MATCH_THRESHOLD ? "auto_routed" : "opportunity_pool") : "generated",
        env.LEAD_TTL_HOURS,
      ],
    );
    const leadId = leadRow.rows[0].id as string;

    if (!top) {
      await client.query("commit");
      return { routed: false, leadId };
    }

    if (top.score >= env.LEAD_DIRECT_MATCH_THRESHOLD) {
      await client.query(
        `insert into lead_interactions (lead_id, business_id, notification_channel, credit_cost)
         values ($1, $2, 'dashboard', $3) on conflict (lead_id, business_id) do nothing`,
        [leadId, top.id, env.LEAD_DIRECT_CREDIT_COST],
      );
      await client.query("commit");
      return { routed: true, leadId, mode: "direct", businessCount: 1 };
    }

    // Opportunity pool: broadcast to the candidate cohort; first to claim wins, others pay nothing.
    for (const c of scored) {
      await client.query(
        `insert into lead_interactions (lead_id, business_id, notification_channel, credit_cost)
         values ($1, $2, 'dashboard', $3) on conflict (lead_id, business_id) do nothing`,
        [leadId, c.id, env.LEAD_POOL_CREDIT_COST],
      );
    }
    await client.query("commit");
    return { routed: true, leadId, mode: "pool", businessCount: scored.length };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export type ClaimResult =
  | { ok: true; contact: { name: string; email: string; message: string | null }; cost: number }
  | { ok: false; status: 400 | 402 | 404 | 409; error: string };

/**
 * Claim (accept) a routed lead for a business the caller owns (ownership is enforced by the route
 * via requireBusinessAccess). Atomic under row locks: validates the offer, checks + debits credits,
 * marks the interaction accepted, and — for a pool lead — expires the other offers so the lead is
 * claimed exactly once and only the winner is charged.
 */
export async function claimLead(leadId: string, businessId: string): Promise<ClaimResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const lead = await client.query(
      "select id, status, expires_at from leads where id = $1 for update",
      [leadId],
    );
    if (lead.rowCount === 0) {
      await client.query("rollback");
      return { ok: false, status: 404, error: "Lead not found" };
    }
    const l = lead.rows[0];
    if (["claimed", "expired", "won", "lost"].includes(l.status)) {
      await client.query("rollback");
      return { ok: false, status: 409, error: "Lead is no longer available" };
    }
    if (l.expires_at && new Date(l.expires_at).getTime() < Date.now()) {
      await client.query("rollback");
      return { ok: false, status: 409, error: "Lead has expired" };
    }

    const offer = await client.query(
      "select id, credit_cost, interaction_status from lead_interactions where lead_id = $1 and business_id = $2",
      [leadId, businessId],
    );
    if (offer.rowCount === 0) {
      await client.query("rollback");
      return { ok: false, status: 404, error: "This lead was not offered to your business" };
    }
    if (offer.rows[0].interaction_status !== "sent") {
      await client.query("rollback");
      return { ok: false, status: 409, error: "This offer is no longer open" };
    }
    const cost: number = offer.rows[0].credit_cost;

    // Ensure a ledger account, then lock it and check balance.
    await client.query(
      "insert into credit_accounts (business_id) values ($1) on conflict (business_id) do nothing",
      [businessId],
    );
    const acct = await client.query(
      "select balance from credit_accounts where business_id = $1 for update",
      [businessId],
    );
    const balance: number = acct.rows[0].balance;
    if (balance < cost) {
      await client.query("rollback");
      return { ok: false, status: 402, error: "Insufficient credits" };
    }

    // Debit + ledger entry.
    await client.query("update credit_accounts set balance = balance - $2, updated_at = now() where business_id = $1", [businessId, cost]);
    await client.query(
      "insert into credit_transactions (business_id, delta, kind, lead_id) values ($1, $2, 'consume', $3)",
      [businessId, -cost, leadId],
    );

    // Accept this offer; expire the rest (pool); mark the lead claimed.
    await client.query(
      "update lead_interactions set interaction_status = 'accepted', responded_at = now() where lead_id = $1 and business_id = $2",
      [leadId, businessId],
    );
    await client.query(
      "update lead_interactions set interaction_status = 'expired' where lead_id = $1 and business_id <> $2 and interaction_status = 'sent'",
      [leadId, businessId],
    );
    await client.query("update leads set status = 'claimed' where id = $1", [leadId]);

    const contact = await client.query("select contact_name, contact_email, message from leads where id = $1", [leadId]);
    await client.query("commit");

    return {
      ok: true,
      cost,
      contact: {
        name: contact.rows[0].contact_name,
        email: contact.rows[0].contact_email,
        message: contact.rows[0].message,
      },
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Expire leads past their window (called by the cron route). Returns the number expired. */
export async function expireStaleLeads(): Promise<number> {
  await pool.query(
    `update lead_interactions set interaction_status = 'expired'
     where interaction_status = 'sent'
       and lead_id in (select id from leads where expires_at < now())`,
  );
  const r = await pool.query(
    `update leads set status = 'expired'
     where expires_at < now() and status in ('auto_routed', 'opportunity_pool', 'notified')`,
  );
  return r.rowCount ?? 0;
}
