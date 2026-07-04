import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Leads offered to the caller's businesses. This IS the lead-visibility filter (the queued
 * security item): row-scoped to `owner_id = $user` in the query — never a client-supplied filter.
 * Consumer contact details are revealed ONLY for offers this business has ACCEPTED (paid for);
 * open/expired offers show metadata only.
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const r = await pool.query(
    `select l.id as lead_id, l.service_requested, l.budget_hint, l.status as lead_status,
            l.intent_score, l.created_at, l.expires_at,
            li.business_id, b.name as business_name, li.interaction_status, li.credit_cost,
            case when li.interaction_status = 'accepted' then l.contact_name  end as contact_name,
            case when li.interaction_status = 'accepted' then l.contact_email end as contact_email,
            case when li.interaction_status = 'accepted' then l.message       end as message
     from lead_interactions li
     join leads l      on l.id = li.lead_id
     join businesses b on b.id = li.business_id
     where b.owner_id = $1
     order by l.created_at desc
     limit 100`,
    [user.id],
  );
  return NextResponse.json({ leads: r.rows });
}
