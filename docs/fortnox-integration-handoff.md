# Fortnox OAuth2 Integration — Handoff Document

This document describes the complete Fortnox integration built into the AI Voice Platform.
Copy the files listed below into your target project and follow the setup steps.

---

## What it does

- OAuth2 connection flow (admin clicks "Connect Fortnox" → Fortnox login → tokens stored)
- Token storage in Firestore (`fortnox_auth/tokens`), auto-refresh before expiry
- List customers from Fortnox (`GET /customers`)
- Create new Fortnox customer
- Create Fortnox invoice with line items (monthly fee, usage, SMS)
- Send invoice via Fortnox email delivery
- Admin UI: customer dropdown, create-customer form, invoice button

---

## Architecture

```
Dashboard (Next.js)          Control Plane (Express)         Fortnox API
─────────────────────        ─────────────────────────       ─────────────
/api/fortnox/connect  ──→    (redirects to Fortnox)   ──→   OAuth login page
/api/fortnox/callback ──→    POST /fortnox/exchange    ──→   Token endpoint
SettingsForm.jsx      ──→    GET  /billing/customers   ──→   /customers
InvoiceActionPanel    ──→    POST /billing/:id/:mo/create →  /invoices
                             GET  /fortnox/status       ──→   (Firestore)
```

Tokens are stored in Firestore `fortnox_auth/tokens` (single global doc — one Fortnox account per platform).

---

## Files to copy

### Backend (Express / Node.js control-plane)

| File | Purpose |
|------|---------|
| `apps/control-plane/lib/fortnox-tokens.js` | Token management: store, retrieve, auto-refresh |
| `apps/control-plane/routes/fortnox-auth.js` | `GET /fortnox/status`, `POST /fortnox/exchange` |
| `apps/control-plane/routes/billing.js` | Invoice creation, customer list/create |

Mount the routes in your Express app:
```js
app.use("/fortnox", require("./routes/fortnox-auth"));
app.use("/billing", require("./routes/billing"));
```

### Frontend (Next.js App Router)

| File | Purpose |
|------|---------|
| `apps/dashboard/app/api/fortnox/connect/route.js` | Initiates OAuth — redirects to Fortnox |
| `apps/dashboard/app/api/fortnox/callback/route.js` | Handles Fortnox redirect, calls control-plane exchange |
| `apps/dashboard/app/api/billing/customers/route.js` | Proxies `/billing/customers` to control-plane |
| `apps/dashboard/app/api/billing/invoice/route.js` | Proxies invoice create/send to control-plane |
| `apps/dashboard/app/components/SettingsForm.jsx` | Customer picker + create-customer form (admin only) |
| `apps/dashboard/app/components/InvoiceActionPanel.jsx` | Create/Send invoice button |

---

## Environment variables

### Control plane (Cloud Run / server)
```env
FORTNOX_CLIENT_ID=<your app client id>
FORTNOX_CLIENT_SECRET=<your app client secret>
```

### Dashboard (Next.js)
```env
FORTNOX_CLIENT_ID=<same client id>
FORTNOX_REDIRECT_URI=https://your-dashboard-url.com/api/fortnox/callback
CONTROL_PLANE_BASE_URL=https://your-control-plane-url.com
CONTROL_PLANE_API_KEY=<your internal api key>
```

---

## Fortnox app setup (one-time)

1. Go to [developer.fortnox.se](https://developer.fortnox.se) and create an app
2. Set redirect URI to: `https://your-dashboard-url.com/api/fortnox/callback`
3. Request scopes: `invoice customer`
   - `invoice` — create, list, send invoices
   - `customer` — list and create customers
4. Copy Client ID and Client Secret to env vars above

**Note:** Without the `customer` scope the customer dropdown will fail. Both scopes are required.

---

## Firestore collections required

| Collection | Doc | Purpose |
|-----------|-----|---------|
| `fortnox_auth` | `tokens` | OAuth tokens (access_token, refresh_token, expires_at) |
| `billing_invoices` | `<tenantId>_<YYYY-MM>` | Invoice records per tenant per month |
| `tenant_settings` | `<tenantId>` | Stores `fortnox_customer_number` per tenant |

---

## OAuth flow (step by step)

1. Admin visits `/settings?tenant=<id>`
2. Clicks **Connect Fortnox** → hits `GET /api/fortnox/connect?tenant=<id>`
3. Next.js route builds Fortnox auth URL with `state=fortnox_connect:<tenantId>` and redirects
4. Admin logs in to Fortnox and approves
5. Fortnox redirects to `GET /api/fortnox/callback?code=<code>&state=fortnox_connect:<tenantId>`
6. Callback extracts code, calls `POST /fortnox/exchange` on control-plane with `{ code, redirect_uri }`
7. Control-plane exchanges code for access+refresh tokens, stores in Firestore `fortnox_auth/tokens`
8. Callback redirects to `/settings?tenant=<id>&fortnox=connected`

Token auto-refresh: `getValidAccessToken()` in `fortnox-tokens.js` checks expiry before every API call. If less than 2 minutes remain, it refreshes automatically. Fortnox issues a new refresh token on each refresh — old one becomes invalid, so store it.

---

## Invoice creation flow

1. Admin goes to Billing page for a tenant + month
2. Clicks **Create invoice**
3. `POST /billing/:tenantId/:month/create`:
   - Reads `fortnox_customer_number` from `tenant_settings/<tenantId>`
   - Aggregates `call_sessions` for the month → minutes × price/min
   - Aggregates `sms_sessions` for the month → count × 3.50 SEK
   - Builds `Invoice` payload with line items
   - Calls `POST https://api.fortnox.se/3/invoices`
   - Saves result to `billing_invoices/<tenantId>_<YYYY-MM>`
4. Admin clicks **Send via Fortnox** → `GET /invoices/:number/email` → Fortnox emails the customer

**422 error?** Means `fortnox_customer_number` is not set for the tenant. Admin must pick/create a customer in Settings first.

---

## Adapting to your project

The integration is intentionally generic. The only platform-specific parts are:

- **Line items in `billing.js`**: monthly fee, per-minute calls, per-SMS cost. Replace with your own billing logic.
- **Data sources**: `call_sessions` and `sms_sessions` Firestore collections. Replace with your usage data.
- **`tenant_settings` doc**: stores `fortnox_customer_number`. You may already have a settings collection — just add this field.
- **Admin-only guard**: The connect/callback/customer routes check for admin scope. Wire this to your own auth system.

Everything else (token management, OAuth flow, Fortnox API calls) is unchanged.

---

## Testing checklist

- [ ] Connect Fortnox as admin → token stored in Firestore `fortnox_auth/tokens`
- [ ] Customer dropdown loads in Settings
- [ ] Create new customer → appears in Fortnox + dropdown
- [ ] Select customer → save → `fortnox_customer_number` appears in `tenant_settings`
- [ ] Create invoice → invoice appears in Fortnox as draft
- [ ] Send invoice → customer receives email from Fortnox
- [ ] Token auto-refresh: manually set `expires_at` to past in Firestore, trigger an API call → new token fetched

---

## Key gotchas

1. **Scope must include `customer`** — `invoice` alone gives 400 on the customers endpoint
2. **Reconnect after scope change** — if token was issued with wrong scopes, must re-OAuth
3. **Fortnox rotates refresh tokens** — always store the new refresh_token from each refresh response
4. **Single Fortnox account** — tokens are global, not per-tenant. One Fortnox account invoices all tenants.
5. **Invoice line item prices are ex-VAT** — VAT is set separately per row (25% for Swedish services)
6. **`redirect_uri` must match exactly** — what you register in Fortnox app settings must match `FORTNOX_REDIRECT_URI` env var
