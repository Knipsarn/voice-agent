# Fortnox Integration Package

This package adds Fortnox OAuth2 authentication, customer management, and monthly invoice creation to a project that consists of:

- An **Express.js backend** (control-plane) that communicates directly with the Fortnox API and owns Firestore state.
- A **Next.js 14+ App Router frontend** (dashboard) that proxies all Fortnox operations through the backend via a shared API key.

The integration covers:
1. One-time OAuth2 connection flow (admin visits a URL, authorizes in Fortnox, tokens stored in Firestore).
2. Fortnox customer picker — list customers, create new ones, and link them to tenants.
3. Monthly invoice creation — aggregates call minutes and SMS from Firestore, creates a Fortnox invoice, and optionally emails it to the customer.

No prior knowledge of this repository is assumed. Read this file plus the package files to implement end-to-end.

---

## File structure and destination paths

```
fortnox-package/
│
├── backend/                          → goes into your Express control-plane app root
│   ├── lib/
│   │   └── fortnox-tokens.js         → apps/control-plane/lib/fortnox-tokens.js
│   └── routes/
│       ├── fortnox-auth.js           → apps/control-plane/routes/fortnox-auth.js
│       └── billing.js                → apps/control-plane/routes/billing.js
│
└── frontend/                         → goes into your Next.js dashboard app root
    ├── app/
    │   └── api/
    │       ├── fortnox/
    │       │   ├── connect/
    │       │   │   └── route.js      → app/api/fortnox/connect/route.js
    │       │   └── callback/
    │       │       └── route.js      → app/api/fortnox/callback/route.js
    │       └── billing/
    │           ├── customers/
    │           │   └── route.js      → app/api/billing/customers/route.js
    │           └── invoice/
    │               └── route.js      → app/api/billing/invoice/route.js
    ├── components/
    │   ├── SettingsForm.jsx           → app/components/SettingsForm.jsx
    │   └── InvoiceActionPanel.jsx     → app/components/InvoiceActionPanel.jsx
    └── lib/
        └── control-plane-fortnox.js  → lib/control-plane-fortnox.js
```

**Important:** The frontend API routes import from `@/lib/control-plane-fortnox`. If your project already has a `lib/control-plane.js`, merge the functions from `control-plane-fortnox.js` into it instead of creating a separate file, then update the import paths in the four `app/api/` route files.

---

## Environment variables

### Backend (Express / control-plane `.env` or Secret Manager)

| Variable | Required | Default | Description |
|---|---|---|---|
| `FORTNOX_CLIENT_ID` | Yes | — | Client ID from developer.fortnox.se |
| `FORTNOX_CLIENT_SECRET` | Yes | — | Client secret from developer.fortnox.se |
| `PRICE_PER_MINUTE_SEK` | No | `3` | Per-minute call price billed to tenant |
| `STATIC_MONTHLY_FEE_SEK` | No | `1000` | Fixed monthly platform fee per tenant |

The backend also requires Google Cloud credentials to access Firestore. In Cloud Run this is the service account's default identity. Locally, set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file.

### Frontend (Next.js `.env.local` or deployment env)

| Variable | Required | Default | Description |
|---|---|---|---|
| `FORTNOX_CLIENT_ID` | Yes | — | Same value as backend — used to build the OAuth authorization URL |
| `FORTNOX_REDIRECT_URI` | Yes | hardcoded Cloud Run URL | Must exactly match what you registered in developer.fortnox.se |
| `CONTROL_PLANE_BASE_URL` | Yes | hardcoded Cloud Run URL | Base URL of your Express backend |
| `CONTROL_PLANE_API_KEY` | Yes | — | Shared Bearer token; backend auth middleware validates this |

---

## One-time Fortnox app setup

1. Go to [developer.fortnox.se](https://developer.fortnox.se) and sign in with your Fortnox account.
2. Create a new application. Choose **Integration** type.
3. Set the **Redirect URI** to exactly: `https://<your-dashboard-domain>/api/fortnox/callback`
   - This value must match `FORTNOX_REDIRECT_URI` in your frontend env and the `redirect_uri` sent in every token exchange call. Even a trailing slash difference will cause a `redirect_uri_mismatch` error.
4. Under **Scopes**, request: `invoice customer`
   - `invoice` — create, read, send invoices.
   - `customer` — list and create customers. Without this scope the customer picker will fail with a 403.
5. Copy the **Client ID** and **Client Secret** into your env vars on both backend and frontend.
6. Submit the app for review if required (some scope combinations need approval).

---

## OAuth flow — step by step

The flow is a standard Authorization Code grant with offline access (refresh tokens).

```
Admin browser          Next.js frontend          Express backend         Fortnox
     │                        │                        │                    │
     │  GET /api/fortnox/connect?tenant=<id>           │                    │
     │───────────────────────>│                        │                    │
     │                        │ builds auth URL        │                    │
     │  302 redirect          │                        │                    │
     │<───────────────────────│                        │                    │
     │                        │                        │                    │
     │  GET apps.fortnox.se/oauth-v1/auth?...          │                    │
     │──────────────────────────────────────────────────────────────────────>│
     │                        │                        │                    │
     │  (admin clicks Allow)  │                        │                    │
     │                        │                        │                    │
     │  GET /api/fortnox/callback?code=X&state=fortnox_connect:<id>         │
     │<──────────────────────────────────────────────────────────────────────│
     │───────────────────────>│                        │                    │
     │                        │ POST /fortnox/exchange {code, redirect_uri} │
     │                        │───────────────────────>│                    │
     │                        │                        │ POST /oauth-v1/token
     │                        │                        │───────────────────>│
     │                        │                        │ {access_token,     │
     │                        │                        │  refresh_token,    │
     │                        │                        │  expires_in}       │
     │                        │                        │<───────────────────│
     │                        │                        │ stores in Firestore│
     │                        │ {connected: true}      │                    │
     │                        │<───────────────────────│                    │
     │  302 /settings?fortnox=connected                │                    │
     │<───────────────────────│                        │                    │
```

After the initial connect, `fortnox-tokens.js` transparently refreshes the access token when fewer than 2 minutes remain. Refresh tokens are rotated by Fortnox on every refresh — the new one is always stored.

---

## Mounting the backend routes in Express

In your Express `index.js` (or `app.js`), after your auth middleware:

```js
const fortnoxAuthRouter = require("./routes/fortnox-auth");
const billingRouter     = require("./routes/billing");

// Auth middleware (whatever your project uses) must run first
app.use(authMiddleware);

// Mount Fortnox routes
app.use("/fortnox", fortnoxAuthRouter);   // GET /fortnox/status, POST /fortnox/exchange
app.use("/billing", billingRouter);       // GET/POST /billing/customers, GET/POST /billing/:id/:month/...
```

The route files use `require("../lib/fortnox-tokens")` — ensure the relative path is correct for your project structure. If your routes are not in a `routes/` subfolder relative to `lib/`, adjust the require path.

---

## How the frontend routes proxy to the backend

The Next.js API routes are thin Server Components that:
1. Validate the session (via `next-auth`) and check that the user has `admin` scope.
2. Call the corresponding control-plane function from `lib/control-plane-fortnox.js`.
3. Return the JSON response directly.

The `control-plane-fortnox.js` helper uses `CONTROL_PLANE_BASE_URL` and attaches `Authorization: Bearer <CONTROL_PLANE_API_KEY>` to every request. The API key never leaves the server.

Client components (`SettingsForm`, `InvoiceActionPanel`) make `fetch` calls to the Next.js API routes — never directly to the control-plane or Fortnox.

```
Client component
  └── fetch("/api/billing/customers")
        └── app/api/billing/customers/route.js  (Next.js server)
              └── listFortnoxCustomers()  (lib/control-plane-fortnox.js)
                    └── GET <CONTROL_PLANE_BASE_URL>/billing/customers
                          └── billing.js router  (Express)
                                └── fortnoxRequest("GET", "/customers")  (Fortnox API)
```

---

## Firestore collections

All Firestore access is in the Express backend. The frontend never touches Firestore directly.

| Collection | Doc ID format | Purpose |
|---|---|---|
| `fortnox_auth` | `tokens` (single doc) | Stores current OAuth tokens (access_token, refresh_token, expires_at) |
| `tenant_settings` | `<tenantId>` | Stores per-tenant settings. `fortnox_customer_number` field links a tenant to their Fortnox customer. |
| `billing_invoices` | `<tenantId>_<YYYY-MM>` | Invoice records: status, Fortnox invoice number, line-item breakdown, timestamps. |
| `call_sessions` | (auto) | Source of call minutes billed. Must have `tenant_id` (string) and `initiated_at` (Timestamp) and `duration_ms` (number) fields. |
| `sms_sessions` | (auto) | Source of SMS line items. Must have `tenant_id`, `sent_at` (Timestamp), and `cost_customer_sek` (number) fields. |

Required Firestore indexes (composite):
- `call_sessions`: `tenant_id` ASC + `initiated_at` ASC
- `sms_sessions`: `tenant_id` ASC + `sent_at` ASC

Create these in the Firebase console or via `firestore.indexes.json` if they do not exist — Firestore will return a link to create them in the error message on the first query.

---

## Gotchas

**1. Scope must include `customer`**
If you only request `invoice` scope, `GET /customers` returns 403. The scope string in `connect/route.js` is `"invoice customer"` (space-separated). Ensure your Fortnox app is approved for both.

**2. The redirect URI must match exactly**
Fortnox performs a string equality check. `http` vs `https`, trailing slash, or any extra character causes `invalid_client`. The same `FORTNOX_REDIRECT_URI` value must be used in three places: Fortnox developer portal, `connect/route.js`, and `callback/route.js`. Both Next.js routes read it from the same env var so they stay in sync.

**3. Token rotation — never discard the new refresh token**
On every successful refresh, Fortnox invalidates the old refresh token and issues a new one. `fortnox-tokens.js` always stores `data.refresh_token || stored.refresh_token`. If you write custom token logic, ensure you persist the new refresh token or you will be locked out after the first rotation.

**4. Single Fortnox account for the whole platform**
There is one `fortnox_auth/tokens` document. All tenants share the same Fortnox company account (the account that authorized the OAuth app). This is by design — invoices are created in one bookkeeping account. If you need per-tenant Fortnox accounts, each tenant needs its own OAuth flow and token storage keyed by tenantId.

**5. `fortnox_customer_number` must be set before invoicing**
`POST /billing/:tenantId/:month/create` checks `tenant_settings/<tenantId>.fortnox_customer_number` and returns HTTP 422 if it is missing. The admin must open Settings, pick or create a Fortnox customer, and save before the first invoice can be created.

**6. Invoice creation is idempotent**
If status is already `"created"`, the create endpoint returns the existing record with `idempotent: true`. It will not create a duplicate invoice in Fortnox. However, if status is `"failed"`, it retries.

**7. Sending email uses Fortnox's own email**
`POST /billing/:tenantId/:month/send` calls `GET /invoices/<number>/email` in the Fortnox API, which triggers Fortnox to send an email to the address stored on the customer record in Fortnox (not in your system). Make sure the customer's email is set in Fortnox before sending.

**8. Next.js import alias**
The frontend files use `@/lib/...` and `@/lib/auth-config` which depend on a `tsconfig.json` or `jsconfig.json` path alias mapping `@` to the app root. Ensure your project has this configured. Standard Next.js projects created with `create-next-app` include it by default.

**9. `userScope` and `authOptions` are project-specific**
`connect/route.js` and the billing API routes import `userScope` from `@/lib/tenant-map` and `authOptions` from `@/lib/auth-config`. These are not included in this package — they are part of your existing auth layer. `userScope(email)` must return an object with an `admin` boolean. Adapt the auth checks to your project's session/role system.

---

## Testing checklist

Work through these steps in order after deployment.

- [ ] **Backend env vars** — confirm `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET` are set on the Express service. Check with `GET /fortnox/status` — should return `{ connected: false }` (not an error about missing credentials).
- [ ] **Frontend env vars** — confirm `FORTNOX_CLIENT_ID`, `FORTNOX_REDIRECT_URI`, `CONTROL_PLANE_BASE_URL`, `CONTROL_PLANE_API_KEY` are set on the Next.js service.
- [ ] **OAuth connect** — as an admin user, visit `/api/fortnox/connect`. Confirm you are redirected to Fortnox's authorization page. Authorize. Confirm redirect back to `/settings?fortnox=connected`.
- [ ] **Status endpoint** — `GET /fortnox/status` (via control-plane) should now return `{ connected: true, expires_at: "...", needs_refresh: false }`.
- [ ] **Customer list** — open the Settings page for any tenant. The Fortnox customer dropdown should load. If it shows an error, check the browser network tab for the `/api/billing/customers` response.
- [ ] **Create customer** — in the dropdown, choose "+ Create new customer in Fortnox…". Fill in a company name and click "Create in Fortnox". The new customer should appear in the dropdown and auto-select.
- [ ] **Save customer link** — select a customer and save settings. Confirm `tenant_settings/<tenantId>` in Firestore has `fortnox_customer_number` set.
- [ ] **Create invoice** — on a billing page, click "Create invoice" for a past month. Check `billing_invoices/<tenantId>_<YYYY-MM>` in Firestore for `status: "created"` and a `fortnox_invoice_number`.
- [ ] **Verify in Fortnox** — log into Fortnox and confirm the invoice exists with the correct customer, line items, and amounts.
- [ ] **Send invoice** — click "Send via Fortnox". Status should change to `"sent"`. Check that the customer's email address in Fortnox received the invoice email.
- [ ] **Token refresh** — wait until the access token is near expiry (or temporarily set `expires_at` in Firestore to a past timestamp) and repeat a billing action. Confirm it succeeds and Firestore shows a fresh `expires_at`.
- [ ] **Error state recovery** — temporarily remove `fortnox_customer_number` from `tenant_settings`, attempt invoice creation, and confirm you get the 422 error message. Re-add the number and confirm it succeeds.
