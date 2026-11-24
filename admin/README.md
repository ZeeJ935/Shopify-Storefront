# ZJ Admin (staff dashboard)

Internal app for staff: orders, inventory, fulfillment and the audit log. Separate from the storefront (own folder, own Vercel project) and from the backend's `/v1` API. It never shows customer names, emails or addresses — we don't store them. **If staff need them, they look the order up in Shopify admin by its order number** (e.g. `#1007`).

## How it works

```text
Browser ──► admin app (Next.js, Vercel) ──► backend /admin/* (Render) ──► Postgres / Shopify Admin API
              │  Google sign-in (code + PKCE, state, nonce)
              │  sealed httpOnly session cookie (staff JWT inside)
```

- Sign-in: `/login` → `/auth/google` → Google → `/auth/callback`. The callback sends the Google ID token to the backend (`POST /admin/auth/exchange`), which verifies it, checks `ADMIN_ALLOWLIST`, and returns a 15-minute staff token. Every failure shows the same message.
- The browser never calls the backend. This app's server sends `ADMIN_API_TOKEN` + the staff token on every call.
- `proxy.ts` refreshes the staff token shortly before it expires (the backend re-checks the allowlist) and sends staff to `/login` after **8 hours** from sign-in — a hard limit refresh never extends.
- Roles come from the backend's allowlist: **viewer** (read), **operator** (+ fulfill), **admin** (+ syncs, audit log). The UI hides what a role can't do; server actions and the backend check again.
- **Warehouse** (`/warehouse`): the mock warehouse vs Shopify **on_hand**, with available and committed shown read-only, status badges, a differences-only filter and the last reconcile time. A banner shows when the backend is in `dry_run` mode. Operators select rows (or “All differences”), optionally tick *Dry run only* / *Allow large decreases*, and get a confirm screen listing SKU, location and on_hand from → to (large decreases flagged); the idempotency key is created once per confirm screen. Then a progress page shows the push log until it's done. Admins can edit the mock stock inline or add a SKU. The backend enforces every role and audits every change.
- **Fulfill:** choose items → **dry run** → a confirm screen showing exactly what will be sent → confirm. *Notify customer* is unticked by default and shows a warning when ticked. The idempotency key is created once per confirm screen (sealed on the server with the exact request), so double clicks can't fulfill twice.

Backend side (routes, audit log, rate limits, roles): [backend/README.md → Staff admin API](../backend/README.md#staff-admin-api-admin).

## Security

- `noindex` (header, meta, `robots.txt`), `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, strict CSP with a per-request nonce (`proxy.ts`, `lib/csp.ts`).
- Session and sign-in cookies: AES-256-GCM sealed, `httpOnly`, `SameSite=Lax`, `Secure` on https; the session cookie never outlives the 8-hour limit.
- Logout is POST + same-origin only; server actions get Next's origin check and re-check the role.
- Sentry (optional) is scrubbed like the storefront's: no cookies, bodies, query strings, tokens or IP headers, and staff emails are masked (`lib/sentry-scrub.ts`).

## Environment (server-side only)

| Name | Notes |
|------|-------|
| `BACKEND_URL` | Backend origin, e.g. `https://<api>.onrender.com` |
| `ADMIN_API_TOKEN` | Same value as the backend's `ADMIN_API_TOKEN` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (the backend's `ADMIN_GOOGLE_CLIENT_ID` must be the same id) |
| `ADMIN_SESSION_SECRET` | Encrypts cookies; ≥32 chars (`openssl rand -base64 48`) |
| `ADMIN_APP_URL` | This app's origin, no trailing slash (builds the Google redirect URI) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional |

## Run locally

```bash
# backend/.env: ADMIN_API_TOKEN, ADMIN_JWT_SECRET, ADMIN_GOOGLE_CLIENT_ID, ADMIN_ALLOWLIST=you@x.com:admin
cd backend && npm run dev            # http://127.0.0.1:4000
cd admin && cp .env.example .env     # fill in; BACKEND_URL=http://127.0.0.1:4000, ADMIN_APP_URL=http://localhost:3001
npm install && npm run dev           # http://localhost:3001
```

Without Google: `cd backend && npm run admin:token -- you@x.com` prints a staff token for curl against `/admin/*` (local database only).

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (CI runs all four).

## Setup checklist (production)

1. **Google Cloud** → APIs & Services → OAuth consent screen (Internal if you use Google Workspace; otherwise External with your staff as test users) → Credentials → OAuth client ID → *Web application*. Authorized redirect URIs: `https://<admin-domain>/auth/callback` (and `http://localhost:3001/auth/callback` for local).
2. **Backend (existing Render service, dashboard → Environment)**: `ADMIN_API_TOKEN`, `ADMIN_JWT_SECRET`, `ADMIN_ALLOWLIST`, `ADMIN_GOOGLE_CLIENT_ID` (optional `ADMIN_GOOGLE_HOSTED_DOMAIN`). No change to `render.yaml` or plans. Deploy (migration 0009 runs on start).
3. **Vercel**: a second project from this repo with **Root Directory `admin`**, the env vars above, then deploy.
4. Sign in with an allowlisted account; check the Audit page shows `auth.login`.

## Rotating secrets

- **`ADMIN_API_TOKEN`**: backend: set the old value as `ADMIN_API_TOKEN_PREVIOUS` and a new `ADMIN_API_TOKEN`, deploy → admin app: set the new `ADMIN_API_TOKEN`, deploy → backend: remove `ADMIN_API_TOKEN_PREVIOUS`.
- **`ADMIN_JWT_SECRET`** (backend only): set the old value as `ADMIN_JWT_SECRET_PREVIOUS` and a new `ADMIN_JWT_SECRET`, deploy; remove the previous one after 8 hours. Leaked? Replace it without a previous value — everyone signs in again.
- **`ADMIN_SESSION_SECRET`** (admin app): change and deploy; everyone signs in again (open confirm screens expire too).
- **`GOOGLE_CLIENT_SECRET`**: add a new secret in Google Cloud, update the admin app, deploy, then delete the old secret in Google Cloud.
- **Remove a staff member**: delete them from `ADMIN_ALLOWLIST` and redeploy the backend; their next request is refused.
