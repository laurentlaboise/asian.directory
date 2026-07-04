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
| **SEC-7 Role/session gate on writes** | First protected write route (claim) validates the server-side session via `requireUser()` (`lib/session.ts`) before any mutation; middleware stays an optimistic redirect only. `getRole`/`hasRole` available for role checks. | `lib/session.ts`, `app/api/businesses/[id]/claim/route.ts` |
| **Claim ≠ verification** | Claiming assigns **ownership only** — it does NOT raise `verification_tier` (no OTP/email/phone proof happens). Tier 1+ is reserved for a real proof flow, so the DB never asserts an unearned verification. | `app/api/businesses/[id]/claim/route.ts` |
| **Claim race / double-claim** | Ownership transition runs under `SELECT … FOR UPDATE` in a transaction; a second concurrent claim sees the taken row and gets `409`. | `app/api/businesses/[id]/claim/route.ts` |
| **Audit logging** | Security-relevant actions (claims now; auth events + lead claims as they land) append to `audit_log` via `logAudit()`, on a separate connection so it can't roll back the business op. | `lib/audit.ts`, `db/…/0002_auth_fks_audit.sql` |
| **SEC-8 CSP disabled** | **Nonce-based CSP** (middleware) + HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`. | `middleware.ts`, `next.config.ts` |
| **SQL injection** | All queries fully **parameterized**; user input never string-concatenated into SQL. | `app/api/search/route.ts` |
| **Info-leak error handling** | API returns generic errors; detail is `console.error`-logged only. | `app/api/search/route.ts` |
| **Input validation** | Every request body validated with **zod** before use. | `app/api/search`, `synthesis`, `assistant` |
| **LLM surface abuse/cost** | LLM-backed routes (synthesis/assistant/reformulate) are rate-limited tighter than search; prompt business content is fetched from the DB by id (not client-supplied); output is schema-constrained (synthesis) or capped and rendered as text (assistant), containing prompt-injection blast radius. | `app/api/synthesis`, `app/api/assistant`, `lib/reformulate.ts` |

## Still to do (tracked, not silently skipped)

- Rate limiter is **in-memory** (single replica) — move to Redis/Upstash before horizontal scale.
- Apply `requireUser()`/`hasRole()` to every remaining protected route as the merchant dashboard
  and lead surfaces land (claim route is the first).
- **Lead-object visibility filters** — once leads exist, restrict reads so a merchant sees only
  leads routed to their own claimed businesses (row-scoping in the query, not the client).
- Extend `audit_log` coverage to auth events (login/logout/failed-login via Better Auth hooks)
  and lead claims.
- CSRF: Better Auth cookies are `sameSite=lax`; add explicit CSRF tokens for any state-changing
  form posts that could be triggered cross-site.
- Secret management: inject via Railway variables; never commit `.env`. (Env is validated
  fail-closed at **runtime**; the check is skipped only during `next build`, so ensure the
  build environment — which on Railway shares service variables — has them too.)
- `DATABASE_SSL` defaults to `off` (correct for Railway's private network). If ever pointing at
  an **external** DB, set `require` — otherwise credentials traverse in cleartext with no warning.
