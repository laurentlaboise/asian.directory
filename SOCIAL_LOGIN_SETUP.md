# Social login setup (Google + Facebook)

The admin section supports three ways in: username + password, Google, and Facebook.
The code for all three is finished. Google and Facebook additionally need credentials
that only the owner of the Google Cloud and Meta accounts can create — this document
is the checklist for that, plus the Railway variables to paste them into.

Until the credentials are set, the two social buttons on `/admin-login.html` appear
greyed out and say the provider is not configured. Username + password keeps working.

---

## The two URLs involved

| What | URL |
|---|---|
| Frontend (GitHub Pages) | `https://asian.directory` |
| Backend API (Railway) | `https://asiandirectory-production-7ec4.up.railway.app` |

Sign-in starts on the frontend, bounces through the backend to the provider, and
comes back to `https://asian.directory/admin-login.html` with a token.

---

## 1. Google

1. Open <https://console.cloud.google.com/> and select a project (or create one,
   e.g. `asian-directory`).
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `asian.directory`, support email: your address
   - Authorised domain: `asian.directory`
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - While the app is in **Testing**, only accounts listed under **Test users** can
     sign in — add your own Google address there, or click **Publish app**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorised JavaScript origins:
     - `https://asian.directory`
     - `https://asiandirectory-production-7ec4.up.railway.app`
   - Authorised redirect URIs (both — the second one is the separate Google Business
     Profile connection used inside the dashboard):
     - `https://asiandirectory-production-7ec4.up.railway.app/api/auth/google/callback`
     - `https://asiandirectory-production-7ec4.up.railway.app/api/google/oauth/callback`
4. Copy the **Client ID** and **Client secret**.

The redirect URI has to match what the server sends, character for character. A
mismatch is Google's `redirect_uri_mismatch` error, and the login page now reports it.

---

## 2. Facebook

1. Open <https://developers.facebook.com/apps/> → **Create app** → use case
   **Authenticate and request data from users with Facebook Login** → type **Consumer**.
2. Add the **Facebook Login** product → **Settings**:
   - Client OAuth login: **On**
   - Web OAuth login: **On**
   - Valid OAuth Redirect URIs:
     `https://asiandirectory-production-7ec4.up.railway.app/api/auth/facebook/callback`
3. **App settings → Basic**: add `asian.directory` under App domains, set the Privacy
   Policy URL (Facebook requires one before the app can leave development mode), and
   copy the **App ID** and **App secret**.
4. While the app is in development mode, only people listed under **App roles** can
   sign in. To let anyone in, switch the app to **Live** — the `email` permission is
   granted by default and needs no App Review.

Note: Facebook only returns an email address when the account has a confirmed one and
the person grants it. Accounts without an email still sign in; they just get a row
with no email, so `ADMIN_EMAILS` cannot promote them — set their role from the Users
tab in the dashboard instead.

---

## 3. Railway variables

Railway → the backend service → **Variables**:

```
GOOGLE_CLIENT_ID=<from step 1>
GOOGLE_CLIENT_SECRET=<from step 1>
GOOGLE_CALLBACK_URL=https://asiandirectory-production-7ec4.up.railway.app/api/auth/google/callback

FACEBOOK_APP_ID=<from step 2>
FACEBOOK_APP_SECRET=<from step 2>
FACEBOOK_CALLBACK_URL=https://asiandirectory-production-7ec4.up.railway.app/api/auth/facebook/callback

ALLOWED_ORIGINS=https://asian.directory,https://www.asian.directory,https://asiandirectory-production-7ec4.up.railway.app
ADMIN_EMAILS=your.google.address@gmail.com
```

`ALLOWED_ORIGINS` matters here as well as for CORS: sign-in is only sent back to an
origin on that list, and the first entry is the fallback when the request arrives
without one.

`ADMIN_EMAILS` is a comma-separated list of addresses that are always made admins on
sign-in. Without it, a social account is created as a `viewer` (read-only) unless it is
the very first account on the site, which is promoted to admin automatically — the same
rule password login already used.

Railway redeploys on a variable change. Confirm with:

```
curl https://asiandirectory-production-7ec4.up.railway.app/api/auth/providers
# {"success":true,"providers":{"password":true,"google":true,"facebook":true}}
```

---

## 4. Test

1. Open <https://asian.directory/admin-login.html> — both buttons should be full colour.
2. Click **Sign in with Google**, pick your account, accept the permission screen.
3. You should land on `admin-dashboard.html`, with your name and an `admin` badge
   in the header.

If something goes wrong you now come back to the login page with the reason printed in
the red banner rather than a page of JSON. The common ones:

| Message | Cause |
|---|---|
| `... is not configured on this server yet` | The client ID or secret variable is missing or empty on Railway. |
| `Google rejected the sign-in. Check that the redirect URI ...` | The redirect URI in the provider console does not match `GOOGLE_CALLBACK_URL` / `FACEBOOK_CALLBACK_URL`. |
| `... sign-in was cancelled` | You dismissed the provider's permission screen. |
| `... expired or could not be verified` | More than 10 minutes passed on the provider's screen, or the return origin is not in `ALLOWED_ORIGINS`. |
| `This account is deactivated` | The user row has `is_active = false`; re-enable it in the Users tab. |

Railway's deploy logs carry the server-side detail for anything else.

---

## Local development

```bash
cd backend
cp .env.example .env      # then fill in the values below
npm install
npm start                 # http://localhost:3000
```

For a local run, register these redirect URIs in the provider consoles as well and
point the variables at them:

```
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
FACEBOOK_CALLBACK_URL=http://localhost:3000/api/auth/facebook/callback
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
```

Google accepts `http://localhost` redirect URIs. Facebook does not — use the Railway
URL, or a tunnel such as ngrok, to exercise Facebook login.
