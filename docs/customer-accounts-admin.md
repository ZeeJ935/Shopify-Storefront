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
| `/account/callback` | Token exchange → session cookie → `returnTo` (default `/account`) |
| `/account` | Account hub (protected) |
| `/account/orders` | Order list (protected) |
| `/account/orders/[id]` | Order detail (protected) |
| `/account/addresses` | Addresses CRUD (protected) |
| `/account/profile` | Profile edit (protected) |
| `/account/favourites` | Favourites wishlist (login required; navbar entry) |
| `/account/refresh` | Refreshes an expiring access token, then returns to `return_to` |
| `/account/logout` | **POST only.** Clears session + cart cookie + Shopify end-session. Cross-site posts are rejected (403) |

When a session is missing or expired, the shopper is sent through `/account/authorize?returnTo=<current page>` and lands back on the same page after logging in. `proxy.ts` passes the current path to account layouts for this.

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

## Cart linked to the customer (buyer identity)

On login, `/account/callback` exchanges the Customer Account token for a **Storefront customer access token** (`storefrontCustomerAccessTokenCreate`), stores it in the sealed session, and links any existing cart with `cartBuyerIdentityUpdate`. Carts created while signed in get `buyerIdentity.customerAccessToken` from the start. Checkout is then tied to the customer's account.

Both steps are best effort: if they fail, login still works and the server log shows `[account] storefront token not issued` or `[account] cart link failed`.

Logging out clears the cart cookie so the next person on a shared device can't check out under that account.

## Addresses

The country dropdown lists the shop's markets from the Storefront API (`localization.availableCountries`). Add a country under **Settings → Markets** to offer it. Province / state is a free-text code (e.g. `CA`, `ON`, `PB`).

## Security notes

- Session + PKCE payloads are AES-GCM sealed; cookies are `httpOnly`, `SameSite=lax`, `Secure` in production
- Account data loaders require a session; unauthenticated users are sent through authorize/login
- `returnTo` / `return_to` paths are resolved and must stay on the storefront's own origin (blocks `//host`, `/\host` and similar)
- Account action failures show a generic message; Shopify API details go to the server log only
- `/account` is disallowed in `robots.txt` and served with `noindex`

## Favourites metafield (required)

Create a **Customer** metafield definition in Shopify Admin:

1. Settings → Custom data → Customers → Add definition
2. Namespace and key: `custom.favourites`
3. Type: **JSON**
4. Access → Customer account API: **Read and write**

Without this, saving favourites returns “Access to this namespace and key on Metafields… is not allowed.”

## Remaining gaps (intentional)

- Order timeline shows Placed → Paid → Shipped only; the query has no delivery status
- Addresses list shows the first 20; orders page at a time is 10
