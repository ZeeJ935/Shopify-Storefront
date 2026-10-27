# Shopify Customer Accounts — Admin & env setup

Headless storefront uses the **Customer Account API** (OAuth 2.0 + PKCE, confidential client) with encrypted httpOnly session cookies. No local customer/order database.

## API

- GraphQL: Customer Account API **2026-10** (discovered via `/.well-known/customer-account-api`, version pinned in config)
- Scopes: `openid email customer-account-api:full`
- Auth header: raw access token (not `Bearer`)

## Routes

| Path | Purpose |
|------|---------|
| `/account/login` | Log in / sign up entry |
| `/account/authorize` | Starts OAuth (sets PKCE cookies, redirects to Shopify) |
| `/account/callback` | Token exchange → session cookie → `/account` |
| `/account` | Account hub (protected) |
| `/account/orders` | Order list (protected) |
| `/account/orders/[id]` | Order detail (protected) |
| `/account/addresses` | Addresses read-only (protected) |
| `/account/logout` | Clears session + Shopify end-session |

## App env (see `.env.example`)

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`
- `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET`
- `SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID`
- `SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL` — must match Admin exactly
- `SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET` — 32+ chars (`openssl rand -base64 48`)
- `SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_REDIRECT_URL` — optional; storefront origin
- `SITE_URL` — used as logout fallback

Production callback example: `https://shopify-storefront-ruby.vercel.app/account/callback`

## Shopify Admin (Headless → Customer Account API)

1. Client type: **Confidential**
2. Callback URL(s): production Vercel callback (+ local HTTPS tunnel if developing)
3. Logout URL: storefront origin (e.g. `https://shopify-storefront-ruby.vercel.app/`)
4. Permissions: customer profile, orders, addresses
5. Enable **New customer accounts** for the shop
6. Request **Protected customer data** access for name/email if prompted

## Security notes

- Session + PKCE payloads are AES-GCM sealed; cookies are `httpOnly`, `SameSite=lax`, `Secure` in production
- Account data loaders require a session; unauthenticated users are sent through authorize/login
- Cart cookies and checkout URL validation are unchanged (buyer identity attachment is out of scope for v1)

## Remaining gaps (intentional)

- Address create/edit UI
- Attaching customer access token to cart buyer identity
- Manual login → orders → logout smoke test against a real customer account
