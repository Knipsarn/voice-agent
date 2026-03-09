# voice-bridge

Shared Cloud Run WebSocket bridge. Accepts Telnyx media streaming, opens an OpenAI GPT-Realtime session, and forwards audio in both directions.

One instance handles all tenants. Tenant-specific behavior is loaded from config at connection time.

---

## Running locally

Run from the **repo root**, not from inside `apps/voice-bridge/`:

```bash
# From repo root
node apps/voice-bridge/index.js
```

The bridge loads `config/.env` automatically for local development.
Do not use `cd apps/voice-bridge && npm start` — the relative env file path will not resolve correctly.

### Install dependencies

```bash
cd apps/voice-bridge
npm install
cd ../..
```

---

## Required env vars

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key with Realtime access |
| `DEFAULT_TENANT_ID` | Recommended | Fallback tenant if no `?tenant=` param in WebSocket URL |
| `DEFAULT_REALTIME_MODEL` | No | Default GPT model (default: `gpt-realtime-1.5`) |
| `TENANT_CONFIG_DIR` | No | Path to tenant JSON files. See below. |
| `PORT` | No | Listening port (default: `8080`, set automatically by Cloud Run) |

### TENANT_CONFIG_DIR is optional

`tenantLoader.js` resolves a default path relative to its own location:

```
apps/voice-bridge/../../config/tenants  →  config/tenants/
```

Only set `TENANT_CONFIG_DIR` to override (e.g., an absolute path in a custom container layout).

---

## How tenant lookup works

On each WebSocket connection from Telnyx:

1. Bridge parses the WebSocket upgrade URL query string
2. Looks for `?tenant=<tenant_id>` in the URL
3. If found: loads `config/tenants/<tenant_id>.json` from disk
4. If not found: falls back to `DEFAULT_TENANT_ID` env var
5. Applies `instructions`, `voice`, `realtime_model` from tenant config to the GPT session

**How n8n passes the tenant:** When n8n starts Telnyx media streaming toward the bridge, it must include the tenant ID in the WebSocket URL:

```
wss://voice-bridge-service-....run.app?tenant=example-company
```

n8n flows are not yet updated to do this (Phase 2+). In the meantime, `DEFAULT_TENANT_ID` covers all inbound calls.

---

## Fallback behavior

If a tenant config cannot be loaded (missing file, bad JSON, no tenant ID), the bridge falls back safely:

| Value | Fallback |
|---|---|
| `instructions` | `"You are a helpful phone assistant."` |
| `voice` | `"alloy"` |
| `realtime_model` | `DEFAULT_REALTIME_MODEL` env var, or `gpt-realtime-1.5` |
| `first_message` | Not triggered |
| Audio codec | Always `g711_ulaw` in and out — never changes |

The call continues normally. No errors are thrown. A warning is logged.

---

## Runtime logs

Every connection logs one line at connection time:

```
[bridge] connection — tenant: example-company | model: gpt-realtime-1.5 | voice: alloy | entry_mode: pbx_first | first_message: true | fallback: false
```

`fallback: true` means no tenant config was found and defaults were used.

---

## Audio codec

**Do not change.** The codec is fixed at G.711 μ-law (`g711_ulaw`) in both directions. This matches the Telnyx bidirectional streaming configuration and is what makes the audio quality work.

---

## Adding a new tenant

### Local development
No restart needed. `loadTenant` reads from disk on every connection. Copy the new tenant JSON to `config/tenants/<tenant_id>.json` and test immediately.

### Cloud Run (Phase 1)
Tenant configs are baked into the container image. Adding a new tenant requires a rebuild and redeploy:

```bash
gcloud run deploy voice-bridge-service \
  --source . \
  --region europe-west1 \
  --project ldk-clean
```

**Phase 2:** Firestore integration will make new tenants available without redeploy.

---

## Deploying to Cloud Run

See `Dockerfile` at repo root. Deploy from repo root:

```bash
gcloud run deploy voice-bridge-service \
  --source . \
  --region europe-west1 \
  --project ldk-clean \
  --set-env-vars OPENAI_API_KEY=<key>,DEFAULT_TENANT_ID=example-company,DEFAULT_REALTIME_MODEL=gpt-realtime-1.5
```

Or set env vars separately via the Cloud Run console to avoid key in shell history.
