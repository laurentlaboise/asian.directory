# Security baseline

This scaffold treats the findings from the original `asian.directory` audit as a regression
checklist — each control below exists specifically so a class of bug from that report cannot
recur. Kept in the repo so the baseline is reviewable and enforceable, not tribal knowledge.

| Original finding | Control in this scaffold | Where |
|---|---|---|
| **SEC-1 Stored XSS** (unescaped `innerHTML` everywhere) | UI renders data as React **text nodes** only — no `innerHTML`/`dangerouslySetInnerHTML`. **Nonce-based CSP** (no `script-src 'unsafe-inline'`) as defense-in-depth. | `app/page.tsx`, `middleware.ts` |
| **SEC-2 Hardcoded secret fallback** | `lib/env.ts` **fails closed** — no default for any secret; process throws at import if missing/short. | `lib/env.ts` |
| **SEC-3 Privilege-escalation bootstrap** (open register + auto-promote to admin) | Roles live in `profiles` (default `viewer`); no self-promotion path. Admin granted out-of-band. Auth handled by Better Auth, not hand-rolled. | `db/…/0001_init.sql`, `lib/auth.ts` |
| **SEC-4 Token in `localStorage` / URL** | Sessions are **httpOnly, secure, sameSite** cookies via Better Auth — not readable by JS, not placed in URLs. | `lib/auth.ts` |
| **SEC-5 `rejectUnauthorized:false` in prod** | DB SSL is explicit; cert-verify is the `require` mode, and the insecure mode is opt-in + discouraged. | `lib/db.ts`, `.env.example` |
| **SEC-6 No `trust proxy`** (wrong IPs / broken rate limit) | `clientIp()` trusts only the proxy-set `x-real-ip` (falls back to the RIGHT-most XFF hop) — never the client-spoofable left-most XFF, so a fresh-bucket bypass isn't possible. | `lib/rate-limit.ts` |
| **SEC-7 No role gate on writes** *(planned)* | Design: mutations validate the server-side session (`auth.api.getSession`) + role; middleware is only an optimistic redirect, never the boundary. **No protected write routes exist yet** — this lands with the Phase-2 merchant portal. | `middleware.ts` today; per-route checks TBD |
| **SEC-8 CSP disabled** | **Nonce-based CSP** (middleware) + HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`. | `middleware.ts`, `next.config.ts` |
| **SQL injection** | All queries fully **parameterized**; user input never string-concatenated into SQL. | `app/api/search/route.ts` |
| **Info-leak error handling** | API returns generic errors; detail is `console.error`-logged only. | `app/api/search/route.ts` |
| **Input validation** | Every request body validated with **zod** before use. | `app/api/search/route.ts` |

## Still to do (tracked, not silently skipped)

- Rate limiter is **in-memory** (single replica) — move to Redis/Upstash before horizontal scale.
- Add a hard FK from `businesses.owner_id` → Better Auth `user(id)` in migration `0002` (after the
  auth tables exist).
- Per-route session+role enforcement helpers for the merchant dashboard (Phase 2).
- CSRF: Better Auth cookies are `sameSite=lax`; add explicit CSRF tokens for any state-changing
  form posts that could be triggered cross-site.
- Secret management: inject via Railway variables; never commit `.env`. (Env is validated
  fail-closed at **runtime**; the check is skipped only during `next build`, so ensure the
  build environment — which on Railway shares service variables — has them too.)
- `DATABASE_SSL` defaults to `off` (correct for Railway's private network). If ever pointing at
  an **external** DB, set `require` — otherwise credentials traverse in cleartext with no warning.
