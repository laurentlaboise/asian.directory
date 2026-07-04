import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });

// .strict() so only these exact columns can ever be written — the SET clause is built from these
// fixed keys, never arbitrary user input, so there is no identifier-injection surface.
const Body = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    website: z.string().url().max(500).nullable().optional(),
  })
  .strict();

const EDITABLE = ["name", "description", "phone", "website"] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  const businessId = p.data.id;

  const access = await requireBusinessAccess(req.headers, businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rl = rateLimit(`biz-edit:${access.user.id}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const fields = EDITABLE.filter((f) => f in body);
  if (fields.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  const set = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = fields.map((f) => (body as Record<string, unknown>)[f]);
  await pool.query(`update businesses set ${set}, updated_at = now() where id = $1`, [businessId, ...values]);

  await logAudit({
    userId: access.user.id,
    action: "business.update",
    entityType: "business",
    entityId: businessId,
    metadata: { fields },
    ip: clientIp(req.headers),
  });

  // Best-effort re-embed when searchable text changes — keeps hybrid search fresh after edits.
  if (fields.includes("name") || fields.includes("description")) {
    try {
      const r = await pool.query("select name, description from businesses where id = $1", [businessId]);
      const b = r.rows[0];
      const content = `${b.name}\n${b.description ?? ""}`.trim();
      const vec = await embedText(content);
      await pool.query(
        `insert into business_embeddings (business_id, lang, content, embedding)
         values ($1, 'en', $2, $3::vector)
         on conflict (business_id, lang) do update set content = excluded.content, embedding = excluded.embedding`,
        [businessId, content, toVectorLiteral(vec)],
      );
    } catch (err) {
      console.error("re-embed after edit failed (non-fatal):", err);
    }
  }

  return NextResponse.json({ success: true });
}
