# Security baseline

This scaffold treats the findings from the original `asian.directory` audit as a regression
checklist — each control below exists specifically so a class of bug from that report cannot
recur. Kept in the repo so the baseline is reviewable and enforceable, not tribal knowledge.

| Original finding | Control in this scaffold | Where |
|---|---|---|
| **SEC-1 Stored XSS** (unescaped `innerHTML` everywhere) | UI renders data as React **text nodes**. The only `dangerouslySetInnerHTML` is JSON-LD, injected as **escaped** (`<`→`<`) non-executable data carrying the CSP nonce (`lib/jsonld.ts`). **Nonce-based CSP** (no `script-src 'unsafe-inline'`) as defense-in-depth. | `app/page.tsx`, SEO pages, `middleware.ts` |
| **SEC-2 Hardcoded secret fallback** | `lib/env.ts` **fails closed** — no default for any secret; process throws at import if missing/short. | `lib/env.ts` |
| **SEC-3 Privilege-escalation bootstrap** (open register + auto-promote to admin) | Roles live in `profiles` (default `viewer`); no self-promotion path. Admin granted out-of-band. Auth handled by Better Auth, not hand-rolled. | `db/…/0001_init.sql`, `lib/auth.ts` |
| **SEC-4 Token in `localStorage` / URL** | Sessions are **httpOnly, secure, sameSite** cookies via Better Auth — not readable by JS, not placed in URLs. | `lib/auth.ts` |
| **SEC-5 `rejectUnauthorized:false` in prod** | DB SSL is explicit; cert-verify is the `require` mode, and the insecure mode is opt-in + discouraged. | `lib/db.ts`, `.env.example` |
| **SEC-6 No `trust proxy`** (wrong IPs / broken rate limit) | `clientIp()` trusts only the proxy-set `x-real-ip` (falls back to the RIGHT-most XFF hop) — never the client-spoofable left-most XFF, so a fresh-bucket bypass isn't possible. | `lib/rate-limit.ts` |
| **SEC-7 Role/ownership gate on writes** *(enforced)* | Every protected write validates the server-side session AND authorization before mutating: `requireBusinessAccess()` gates all business edit/verification routes to the owner-or-admin; `requireRole()` gates role-scoped actions. Middleware stays an optimistic redirect only; the dashboard page re-checks server-side. | `lib/authz.ts`, `lib/session.ts`, `app/api/businesses/[id]/**`, `app/dashboard/page.tsx` |
| **Tier-1 = real proof** | Verification now requires an OTP delivered to the business's **on-file** contact (not a caller-supplied address); codes are CSPRNG, stored **hashed+peppered**, single-use, expiring in 10 min, capped at 5 attempts, compared with `timingSafeEqual`. Tier-2/3 require admin-reviewed evidence. Claiming still assigns **ownership only** (never a tier). | `lib/otp.ts`, `app/api/businesses/[id]/verify/**` |
| **Review abuse** | Reviews require auth, are rate-limited, **can't self-review** your own business, are unique per (business, author), and are held `pending` (never move aggregates until published). Basic spam screening flags links/spam for moderation (transformer detection later). | `app/api/businesses/[id]/reviews/route.ts`, `lib/moderation.ts` |
| **Claim race / double-claim** | Ownership transition runs under `SELECT … FOR UPDATE` in a transaction; a second concurrent claim sees the taken row and gets `409`. | `app/api/businesses/[id]/claim/route.ts` |
| **Audit logging** | Security-relevant actions (claims now; auth events + lead claims as they land) append to `audit_log` via `logAudit()`, on a separate connection so it can't roll back the business op. | `lib/audit.ts`, `db/…/0002_auth_fks_audit.sql` |
| **SEC-8 CSP disabled** | **Nonce-based CSP** (middleware) + HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`. | `middleware.ts`, `next.config.ts` |
| **SQL injection** | All queries fully **parameterized**; user input never string-concatenated into SQL. | `app/api/search/route.ts` |
| **Info-leak error handling** | API returns generic errors; detail is `console.error`-logged only. | `app/api/search/route.ts` |
| **Input validation** | Every request body validated with **zod** before use. User-supplied URLs (website / review media / evidence) are **http(s)-scheme-restricted** via `httpUrl` — `z.url()` alone accepts `javascript:`/`data:`, so schemes are constrained at validation AND guarded again at render (`safeHref`), not left to CSP. | `lib/validation.ts`, business PATCH, reviews, verify/document, `app/biz/[slug]/page.tsx` |
| **LLM surface abuse/cost** | LLM-backed routes (synthesis/assistant/reformulate) are rate-limited tighter than search; prompt business content is fetched from the DB by id (not client-supplied); output is schema-constrained (synthesis) or capped and rendered as text (assistant), containing prompt-injection blast radius. | `app/api/synthesis`, `app/api/assistant`, `lib/reformulate.ts` |

## Still to do (tracked, not silently skipped)

- Rate limiter is **in-memory** (single replica) — move to Redis/Upstash before horizontal scale.
- **Lead-object visibility filters** — deferred to Phase 3 when leads exist. Reads must be
  row-scoped so a merchant sees only leads routed to their own claimed businesses; reuse the
  `requireBusinessAccess()` ownership check as the filter, never trust a client-supplied filter.
- Extend `audit_log` to **auth events** (login/logout/failed-login via Better Auth hooks) — claim,
  business edits, verification (sent/failed/tier1/submission), and reviews are already audited.
- **Admin review surface** for Tier-2/3 `verification_submissions` and `pending` reviews (approve/
  reject → raise tier / publish + recompute aggregates). Admin-role-gated.
- **Media upload**: reviews/evidence currently accept URLs; add signed-upload to object storage
  (R2/S3) with content-type + size limits before exposing publicly.
- OTP delivery: wire a real email provider (`lib/mailer.ts` fails closed in prod until then).
- CSRF: Better Auth cookies are `sameSite=lax`; add explicit CSRF tokens for any state-changing
  form posts that could be triggered cross-site.
- Secret management: inject via Railway variables; never commit `.env`. (Env is validated
  fail-closed at **runtime**; the check is skipped only during `next build`, so ensure the
  build environment — which on Railway shares service variables — has them too.)
- `DATABASE_SSL` defaults to `off` (correct for Railway's private network). If ever pointing at
  an **external** DB, set `require` — otherwise credentials traverse in cleartext with no warning.
