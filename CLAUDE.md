# CLAUDE.md — AI Operator Instructions

You are operating the **AI Voice Platform** (multitenant, Cloud Run + Telnyx + OpenAI GPT-Realtime).
Follow these instructions exactly. They override any general heuristics.

---

## How to use the operator shell

All platform operations go through the **control-plane API** via `scripts/ops/`.
The control-plane must be running locally (`node apps/control-plane/index.js`) or reachable via `CONTROL_PLANE_BASE_URL`.

Run scripts from the repo root:

```
node scripts/ops/health.js
node scripts/ops/tenants-list.js
node scripts/ops/tenant-get.js      <tenantId>
node scripts/ops/tenant-meta.js     <tenantId>
node scripts/ops/tenant-diff.js     <tenantId>
node scripts/ops/tenant-publish.js  <tenantId> [--dry-run]
node scripts/ops/tenant-logs.js     <tenantId> [limit]
node scripts/ops/tenant-errors.js   <tenantId> [limit]
```

Config read from `config/.env`:
- `CONTROL_PLANE_BASE_URL` — default `http://localhost:4000`
- `CONTROL_PLANE_API_KEY` — required for non-health endpoints

---

## Allowed actions

- Read tenant configs from `configs/tenants/<tenantId>.json`
- Read prompt assets from `configs/prompt-assets/<tenantId>/`
- Run any `scripts/ops/` script
- Run `tenant-diff` before publishing to confirm what will change
- Run `tenant-publish --dry-run` to preview a publish without writing
- Run `tenant-publish` (without dry-run) only when the user has confirmed the diff

---

## Not allowed (without explicit user instruction)

- Do NOT run `gcloud` commands unless the user explicitly asks
- Do NOT deploy to Cloud Run (`gcloud run deploy`) on your own
- Do NOT push to git or create commits unprompted
- Do NOT modify `configs/tenants/` or `configs/prompt-assets/` without user confirmation
- Do NOT call Firestore or GCP APIs directly — use the control-plane instead
- Do NOT rotate or expose API keys or secrets

---

## Safe workflow: debugging a tenant

1. `node scripts/ops/health.js` — confirm control-plane is reachable
2. `node scripts/ops/tenant-get.js <tenantId>` — inspect live Firestore document
3. `node scripts/ops/tenant-meta.js <tenantId>` — check publish timestamp and git sha
4. `node scripts/ops/tenant-logs.js <tenantId>` — read recent call logs
5. `node scripts/ops/tenant-errors.js <tenantId>` — check for errors
6. Read local config: `configs/tenants/<tenantId>.json`
7. `node scripts/ops/tenant-diff.js <tenantId>` — compare local vs live

---

## Safe workflow: publishing tenant changes

1. Edit `configs/tenants/<tenantId>.json` (or prompt assets under `configs/prompt-assets/`)
2. `node scripts/ops/tenant-diff.js <tenantId>` — review every changed field
3. `node scripts/ops/tenant-publish.js <tenantId> --dry-run` — confirm no errors
4. Show the diff summary to the user and ask for explicit approval
5. After approval: `node scripts/ops/tenant-publish.js <tenantId>`
6. `node scripts/ops/tenant-meta.js <tenantId>` — verify `published_at` updated

---

## Architecture reminders

- Audio codec is **G.711 μ-law** — never change it
- Realtime model is **gpt-realtime-1.5** — do not switch models unless instructed
- Tenant identity is via `?tenant=<tenantId>` query param on the WebSocket URL
- Source of truth: **Git → publish → Firestore** (never edit Firestore directly)
- `_meta.source` must always be `"git"` after a proper publish
- If `_meta` is missing or `source !== "git"`, the document may be a hotfix — flag it to the user

---

## Project facts

- GCP project: `ldk-clean`
- Cloud Run service: `voice-bridge-service` (region: `europe-west1`)
- Firestore: default database, collection `tenants`
- Control-plane Cloud Run service: `control-plane-service`
- GitHub: https://github.com/Knipsarn/voice-agent (branch: main)
