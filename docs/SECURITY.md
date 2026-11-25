# Security

## Tokens at a glance

| Credential | Held by | Sent as | Protects |
|---|---|---|---|
| `BACKEND_SERVICE_TOKEN` | storefront server, backend | `Authorization: Bearer` | backend `/v1/*`; also the storefront's `/api/revalidate` |
| `ADMIN_API_TOKEN` (+ `_PREVIOUS`) | admin app server, backend | `Authorization: Bearer` | backend `/admin/*` |
| Staff token (HS256 JWT, `ADMIN_JWT_SECRET`) | admin app session cookie | `X-Staff-Token` | identifies the staff member and role on `/admin/*` |
| `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_ADMIN_CLIENT_SECRET` | backend | — | verifying webhook HMACs |
| `SHOPIFY_ADMIN_CLIENT_ID` / `_SECRET` | backend | client credentials grant | Admin API access token (cached, refreshed 60 s early and on 401) |
| `SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET` | storefront | — | sealing shopper session cookies |
| `ADMIN_SESSION_SECRET` | admin app | — | sealing the staff session and confirm tickets |

Browsers never see any of these. All are server-only env vars (no `NEXT_PUBLIC_` prefix).

## Shopper auth (storefront)

- **Login:** Customer Account API OAuth with PKCE (S256) and `state`, as a confidential client (`lib/customer-account/oauth.ts`).
- **Session:** tokens sealed with AES-256-GCM in `httpOnly`, `SameSite=Lax` cookies (`Secure` in production), split into chunks. The cookie lasts 30 days. The access token is refreshed through `/account/refresh` when it is within 60 s of expiry; a failed refresh clears the cookies.
- **Customer ID:** taken from the ID token's `sub` after checking issuer and audience. The signature is **not** verified: the token comes straight from Shopify's token endpoint over TLS with client authentication, which OIDC Core 3.1.3.7 allows (`lib/customer-account/id-token.ts`).
- **Logout:** POST only; cross-site POSTs get 403 in `proxy.ts`. It also clears the cart cookie.
- **Other checks:** checkout URLs are host-checked on the server (https, no credentials, Shopify or store hosts only); login `returnTo` must stay on-site.

## Service token (`/v1`)

- Required, at least 32 characters (`backend/src/env.ts`).
- Compared as SHA-256 digests with `crypto.timingSafeEqual`, so the check is constant time whatever the input length (`backend/src/auth.ts`).
- Applies to every `/v1` route. `x-customer-id` is validated (pattern, ≤255 chars) only after the token passes, so an unauthenticated caller learns nothing about it.

## Staff auth (`/admin`)

**Config.** `ADMIN_API_TOKEN`, `ADMIN_JWT_SECRET` and `ADMIN_GOOGLE_CLIENT_ID` turn the admin API on together. A partial set refuses to start. Every secret must be ≥32 characters and different from the others and from `BACKEND_SERVICE_TOKEN` (`backend/src/admin/env.ts`).

**Two layers on every request.**
1. `ADMIN_API_TOKEN` (or `_PREVIOUS` during rotation), constant-time compare. Missing or wrong: 401.
2. `X-Staff-Token`, verified, then the role is looked up in the **current** `ADMIN_ALLOWLIST`. Removed from the list: 401 on the next request. Role changed: applies immediately.

**Staff token** (`backend/src/admin/jwt.ts`, `jose`):

| Rule | Value |
|---|---|
| Algorithm | HS256 only (other `alg` headers rejected), with a `kid` |
| Lifetime | 15 minutes |
| Hard session limit | 8 hours from sign-in (`sst` claim); refresh keeps the original `sst`, so it never extends |
| Claims | `sub`, `email`, `role`, `sst`, `jti`, `iat`, `exp`; issuer `zj-backend`, audience `zj-admin` |
| Clock tolerance | 30 s |
| Rotation | `ADMIN_JWT_SECRET_PREVIOUS` is accepted by `kid` |

**Google sign-in.**
- The admin app uses code + PKCE with `state` and `nonce`, held in a sealed 10-minute cookie.
- The backend verifies the Google ID token against Google's JWKS: RS256, issuer, audience = client ID, nonce, `email_verified`, and `hd` when `ADMIN_GOOGLE_HOSTED_DOMAIN` is set (`backend/src/admin/google.ts`).

**Roles.**

| Role | Can |
|---|---|
| viewer | read orders, inventory, summary, search, warehouse diff, push status |
| operator | + fulfill, warehouse push |
| admin | + audit log, edit mock stock, reconcile, trigger syncs |

The backend enforces roles; a refusal is 403 and an audit row. The admin UI hides what a role can't do, and its server actions check the role again.

**Abuse limits.**
- `/admin/auth/exchange` allows 10 requests a minute per IP, and `/admin/auth/refresh` 30. The limit is a fixed window kept in memory per process. Over the limit returns 429 with `Retry-After`.
- Every sign-in or refresh failure returns the same `401 {"error":"sign_in_failed"}`; the real reason only goes to the audit log.

**Admin app.**
- The session is a sealed `httpOnly` cookie that never outlives the 8-hour limit.
- An enforced CSP with a per-request nonce, `X-Frame-Options: DENY`, `noindex`, and `Referrer-Policy: no-referrer`.
- Logout is POST and same-origin only.
- Confirm screens use sealed tickets: 15 minutes, bound to the staff member and the action kind.

## Webhooks

- HMAC-SHA256 over the raw body, compared in constant time against each configured secret (`backend/src/shopify-hmac.ts`). Body limit 1 MB.
- Responses:
  - no secret configured: 500, so Shopify retries;
  - bad signature: 401;
  - missing webhook ID or topic: 400.
- Dedupe: `webhook_events.webhook_id` is unique, and the insert and job enqueue share one transaction. Repeats return `200 {duplicate: true}` and do no work.
- Stored payloads are limited by topic (see [DATA-MODEL.md](DATA-MODEL.md#webhook_events-0002-altered-0004-0007)).

## Personal data

**Never stored:**

| Data | How it's kept out |
|---|---|
| Customer names, emails, phones, addresses, notes on orders | Order queries never request those fields (`backend/src/orders/admin-source.ts`) |
| Fulfillment destination, delivery method, contact details | Fulfillment order queries never request them (`backend/src/fulfillments/admin-source.ts`) |
| Raw order, inventory or location webhook bodies | Only `{ id }` is stored; handlers re-fetch (`backend/src/webhooks/payload.ts`) |
| Origin address on fulfillments | Not sent; the stored request is lines, tracking and the notify flag |
| Request bodies or customer data in the audit log | `detail` keeps allowlisted keys only; rejected sign-in emails are a keyed hash |

Staff who need a customer's details look the order up in Shopify admin by its order number.

**Error reporting and logs.**
- Sentry is scrubbed in all three apps before sending. It masks auth headers, cookies, emails, tokens, customer IDs and phone numbers; drops request bodies, query strings and user data; and sets `userInfo: false` (`lib/sentry-scrub.ts`, `backend/src/sentry-scrub.ts`, `admin/lib/sentry-scrub.ts`).
- Backend logs redact secret headers and leave out SQL parameters (`backend/src/errors.ts`).

**Privacy tests** (see [TESTING.md](TESTING.md#privacy-tests)): order webhooks store only the ID; order sync never persists extra personal fields; fulfillment queries never request personal fields; stored fulfillment requests have none; rejected sign-ins store only a hash; logs contain no secrets; Sentry scrubbing.

## Audit before action

Changes made through the admin API go through `audited()` (`backend/src/admin/routes.ts`):

1. A `pending` row is written to `audit_log` **before** anything happens.
2. If that write fails, the action is refused with `503 {"error":"audit_unavailable"}` (fail closed).
3. Afterwards the row is completed as `success`, `rejected` or `error`.

Covered: `fulfillment.create`, `warehouse.push`, `warehouse.stock`, `warehouse.reconcile`, `sync.<kind>`.

Best effort (never blocks the request): sign-ins, refused refreshes, and every 403 denial.

## Content-Security-Policy

| App | Status |
|---|---|
| Storefront | **Report-Only** unless `CSP_ENFORCE=1` (`lib/csp.ts`). Static header, no nonce, so `script-src` includes `'unsafe-inline'`. Reports go to `/api/csp-report` (16 KB cap, origin and path only, each violation logged once an hour). |
| Admin app | **Enforced**, per-request nonce with `'strict-dynamic'` (`admin/proxy.ts`, `admin/lib/csp.ts`). |

Whether the deployed storefront has `CSP_ENFORCE=1` set is **unverified**; the repo default is Report-Only.

## Secrets

- Server-only env vars in Vercel and Render; `.env` files are local and git-ignored. `render.yaml` generates `BACKEND_SERVICE_TOKEN`; everything else is set by hand (`sync: false` or the dashboard).
- Rotation without downtime: `ADMIN_API_TOKEN_PREVIOUS` and `ADMIN_JWT_SECRET_PREVIOUS`. Steps are in [admin/README.md](../admin/README.md#rotating-secrets).
- The backend logger redacts `authorization`, `x-customer-id`, `x-shopify-hmac-sha256`, `cookie`, `x-staff-token`, `x-admin-client-ip`. Admin API network errors keep only the error name (`backend/src/shopify-admin/client.ts`); tokens are never logged.
- Rate limits on the storefront: per IP per minute, search 60, catalog 60, CSP reports 30, Server Actions 120. They are shared through Upstash Redis when configured, and fail open if Redis is down. The client IP is trusted only from Vercel's headers.
