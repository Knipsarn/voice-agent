# CLAUDE.md — AI Voice Platform Operator Manual

You are the operator/engineer for this platform. Follow these instructions exactly.
They override any general heuristics.

---

## 1. What this product is

A **multitenant AI voice agent platform**. Businesses subscribe to get a phone number
that answers calls with a custom AI agent. Each tenant has its own personality, prompt,
knowledge blocks, voice, and language.

**The call flow:**
1. A caller dials a tenant's phone number
2. **n8n** receives the Telnyx webhook and initiates media streaming
3. n8n opens a WebSocket to `voice-bridge-service` with `?tenant=<tenantId>`
4. The bridge loads the tenant config from **Firestore** (runtime source)
5. The bridge builds GPT instructions from the config and opens a **OpenAI Realtime** session
6. Audio flows: Telnyx (G.711 ulaw) <-> Bridge <-> OpenAI Realtime (G.711 ulaw)
7. The agent speaks to the caller using the tenant's voice, language, and prompt

**Business model:** One shared Cloud Run service handles all tenants. Tenant differences = data (configs), not code.

**End goal:** Claude Code (you) is the central operator hub — you can inspect tenants, read logs, publish config changes, and debug issues without the human needing to copy-paste GCP console output.

---

## 2. Architecture

```
Caller -> Telnyx -> n8n (webhook) -> WSS -> voice-bridge-service (Cloud Run)
                                                |
                                    Firestore tenants/<id> (runtime config)
                                                |
                                    OpenAI Realtime API (gpt-realtime-1.5)

Operator (you) -> scripts/ops/* -> control-plane-service (Cloud Run)
                                        |           |
                                   Firestore    Cloud Logging
```

### Services
| Service | Runtime | Purpose |
|---------|---------|---------|
| `voice-bridge-service` | Cloud Run, `europe-west1` | Handles live calls, bridges Telnyx<->OpenAI |
| `control-plane-service` | Cloud Run, `europe-west1` | Operator API: tenant CRUD, diff, publish, logs |

### Data stores
| Store | Purpose |
|-------|---------|
| Firestore `tenants/<id>` | Runtime tenant configs (what the bridge reads per call) |
| Git `configs/tenants/*.json` | Authoring source-of-truth |
| Git `configs/prompt-assets/<id>/*.md` | Modular prompt files, referenced via `$file:` |
| Cloud Logging | Call logs, errors, bridge lifecycle events |
| Secret Manager | `OPENAI_API_KEY`, `CONTROL_PLANE_API_KEY` |

### Key constraints
- Audio codec: **G.711 ulaw** — never change
- Model: **gpt-realtime-1.5** — do not switch unless explicitly instructed
- n8n handles Telnyx webhooks — do NOT change
- Tenant identity: `?tenant=<tenantId>` query param on the WebSocket URL
- `containerConcurrency: 1` — one call per instance, cold start on parallel calls
- `min instances: 1` — always one warm instance

---

## 3. Source-of-truth contract

```
Git (authoring) --publish--> Firestore (runtime)
```

1. **Git** is the authoring source-of-truth (`configs/tenants/`, `configs/prompt-assets/`)
2. **Firestore** is the runtime source-of-truth (what the bridge reads at call start)
3. **publish** is the only normal sync path (Git -> validate -> diff -> Firestore + `_meta` stamp)
4. Direct Firestore edits are **hotfix-only** — must be back-ported to Git within 24h
5. Every published document gets `_meta`: `{ published_at, git_sha, source: "git", schema_version: 1 }`
6. If `_meta` is missing or `source !== "git"` — flag it to the user as a potential hotfix

---

## 4. Tenant config schema

```json
{
  "tenant_id": "enklare-juridik",
  "status": "active|draft",
  "company_name": "Enklare Juridik",
  "default_language": "sv-SE",
  "voice": "marin",                          // OpenAI voice ID
  "realtime_model": "gpt-realtime-1.5",
  "transcription_language": "sv",             // Whisper language code (optional)
  "entry_mode": "direct_to_gpt|pbx_first",
  "first_message_enabled": true,
  "first_message": "Hej och valkommon...",
  "instructions": {
    "base": "inline string OR $file:path",    // Main system prompt
    "default_mode": "INTAKE"                  // Which mode activates on call start
  },
  "modes": {
    "INTAKE": {
      "label": "Arendeintag",
      "instructions": "inline or $file:",     // Mode-specific instructions
      "unlock_blocks": ["category_inference"]  // Knowledge blocks to include
    }
  },
  "knowledge_blocks": {
    "category_inference": "inline or $file:"  // Appended when unlocked by mode
  },
  "features": {
    "direct_to_gpt": true,
    "barge_in": true,
    "mode_switching": false
  },
  "pbx": { "enabled": false, "ai_option_digit": null },
  "phone_numbers": { "primary_e164": "+46..." },
  "audio_assets": { "intro": "gs://...", "voicemail": "gs://..." }
}
```

**`$file:` references** — In local Git configs, string values starting with `$file:` are resolved by `LocalFileTenantProvider` to the file contents at that path. After publish, Firestore contains the resolved inline strings.

---

## 5. Operator shell

All platform operations go through `scripts/ops/`. These wrap the control-plane HTTP API.
Run from the repo root.

### Commands
```
node scripts/ops/health.js                          # Check control-plane is reachable
node scripts/ops/tenants-list.js                    # List all tenants (summary)
node scripts/ops/tenant-get.js      <tenantId>      # Full Firestore document
node scripts/ops/tenant-meta.js     <tenantId>      # _meta stamp only
node scripts/ops/tenant-diff.js     <tenantId>      # Local vs Firestore diff
node scripts/ops/tenant-publish.js  <tenantId> [--dry-run]  # Publish to Firestore
node scripts/ops/tenant-logs.js     <tenantId> [limit]      # Recent call logs
node scripts/ops/tenant-errors.js   <tenantId> [limit]      # Errors/warnings only
```

### Configuration
Set in `config/.env`:
- `CONTROL_PLANE_BASE_URL` — default `http://localhost:4000`. Set to Cloud Run URL for production access.
- `CONTROL_PLANE_API_KEY` — required for all endpoints except /health

### Running control-plane locally
```bash
cd <repo-root>
GOOGLE_CLOUD_PROJECT=ldk-clean node apps/control-plane/index.js
```
Requires `gcloud auth application-default login` for Firestore/Logging access.

---

## 6. Allowed actions

- Read tenant configs from `configs/tenants/<tenantId>.json`
- Read prompt assets from `configs/prompt-assets/<tenantId>/`
- Run any `scripts/ops/` script
- Run `tenant-diff` before publishing to confirm what will change
- Run `tenant-publish --dry-run` to preview without writing
- Run `tenant-publish` (without dry-run) **only after user confirms the diff**
- Edit tenant configs or prompt assets **with user confirmation**
- Commit and push **when user explicitly asks**

---

## 7. Not allowed (without explicit user instruction)

- Do NOT run `gcloud` commands unless explicitly asked
- Do NOT deploy to Cloud Run on your own
- Do NOT push to git or create commits unprompted
- Do NOT call Firestore or GCP APIs directly — use the control-plane
- Do NOT rotate, expose, or print API keys or secrets
- Do NOT delete Cloud Run revisions (rollback targets)
- Do NOT change audio codec, realtime model, or n8n webhook config

---

## 8. Safe workflow: debugging a tenant

```
1. health.js                    -- control-plane reachable?
2. tenant-get.js <id>           -- inspect live Firestore config
3. tenant-meta.js <id>          -- check _meta.published_at, git_sha, source
4. tenant-errors.js <id>        -- any errors/warnings in Cloud Logging?
5. tenant-logs.js <id>          -- recent call lifecycle logs
6. Read configs/tenants/<id>.json  -- local config
7. tenant-diff.js <id>          -- local vs live drift?
```

**If drift found:** the live config differs from Git. Either a publish is needed, or someone hotfixed Firestore directly.

**If errors found:** read the error messages. Common patterns in section 10.

**If no logs:** either no recent calls, or the Cloud Logging filter isn't matching. The filter searches `textPayload` for the tenant ID string.

---

## 9. Safe workflow: publishing tenant changes

```
1. Edit configs/tenants/<id>.json (or configs/prompt-assets/<id>/*.md)
2. tenant-diff.js <id>              -- review every changed field
3. tenant-publish.js <id> --dry-run -- confirm no validation errors
4. Show diff to user, ask for approval
5. tenant-publish.js <id>           -- publish (writes to Firestore + _meta)
6. tenant-meta.js <id>              -- verify published_at updated
```

**Changes take effect on the next call** — no redeploy needed. Firestore is read at call start.

---

## 10. Error playbook

### Agent repeats itself / asks the same question twice
- **Cause:** Prompt/turn-policy issue, or OpenAI realtime VAD false triggers
- **Fix:** Treat as prompt tuning. Edit prompt in Git -> validate -> diff -> publish -> test call

### Agent "answers its own question" (speaks without caller input)
- **Cause:** VAD/turn-detection interpreting silence/noise as speech
- **Fix:** Iterate on prompt to wait more clearly. Long-term: tune realtime session VAD settings

### Swedish voice sounds American
- **Cause:** Voice "alloy" tends to sound American for non-English
- **Fix:** Use voice "marin" or other voices. Edit tenant config `voice` field and publish

### `invalid_grant` / `invalid_rapt` on local scripts
- **Cause:** Expired GCP credentials
- **Fix:** Run `gcloud auth login` + `gcloud auth application-default login`, restart

### `EADDRINUSE: address already in use :::4000`
- **Cause:** Control-plane already running on port 4000
- **Fix:** `netstat -ano | findstr :4000` then `taskkill /PID <pid> /F`

### `PERMISSION_DENIED` on Firestore from Cloud Run
- **Cause:** Service account missing `roles/datastore.user`
- **Fix:** Grant via IAM console or `gcloud projects add-iam-policy-binding`

### `_meta` is null for a tenant
- **Cause:** Tenant was migrated before publish workflow existed
- **Fix:** Run `tenant-publish.js <id>` to re-stamp with `_meta`

### Logs return count: 0
- **Cause:** No recent calls, or log filter doesn't match
- **Note:** Filter searches `textPayload` containing tenant ID. If bridge doesn't log the tenant ID in a given message, it won't match.

### PowerShell `curl` gives Security Warning
- **Cause:** `curl` is alias for `Invoke-WebRequest` in PowerShell
- **Fix:** Use `curl.exe` explicitly

---

## 11. Tenant onboarding checklist

To add a new tenant:

```
1. Create configs/tenants/<new-tenant-id>.json
   - Copy from an existing tenant (e.g., example-company.json)
   - Fill in: tenant_id, company_name, voice, entry_mode, instructions, modes, knowledge_blocks
   - Set status: "draft"

2. (Optional) Create configs/prompt-assets/<new-tenant-id>/
   - Add modular prompt files (*.md)
   - Reference them in the JSON config with $file: paths

3. Validate: node scripts/ops/tenant-publish.js <new-tenant-id> --dry-run
   - Fix any validation errors

4. Diff: node scripts/ops/tenant-diff.js <new-tenant-id>
   - Will show "Firestore document not found" for a new tenant — that's expected

5. Publish: node scripts/ops/tenant-publish.js <new-tenant-id>
   - Creates the Firestore document with _meta

6. Verify: node scripts/ops/tenant-meta.js <new-tenant-id>
   - Confirm published_at and git_sha

7. Test: configure n8n/Telnyx to route a test number to ?tenant=<new-tenant-id>
   - Make a test call
   - Check logs: node scripts/ops/tenant-logs.js <new-tenant-id>

8. When ready: set status to "active" in Git config, re-publish
```

---

## 12. Project facts

| Fact | Value |
|------|-------|
| GCP project | `ldk-clean` |
| Region | `europe-west1` |
| Voice bridge service | `voice-bridge-service` |
| Control-plane service | `control-plane-service` |
| Firestore collection | `tenants` (default database) |
| GitHub | `https://github.com/Knipsarn/voice-agent` (branch: `main`) |
| Service account | `360579353014-compute@developer.gserviceaccount.com` |
| IAM roles | `datastore.user`, `logging.viewer`, `secretmanager.secretAccessor` |
| Secrets | `OPENAI_API_KEY`, `CONTROL_PLANE_API_KEY` (Secret Manager) |
| Live revision | `voice-bridge-service-00008-rep` (100% traffic, `TENANT_PROVIDER=firestore`) |

### Current tenants
| Tenant | Status | Voice | Entry mode | Language |
|--------|--------|-------|------------|----------|
| `example-company` | active | alloy | pbx_first | sv-SE |
| `enklare-juridik` | draft | marin | direct_to_gpt | sv-SE |

### Production URLs
| Service | URL |
|---------|-----|
| voice-bridge-service | `https://voice-bridge-service-360579353014.europe-west1.run.app` |
| control-plane-service | `https://control-plane-service-360579353014.europe-west1.run.app` |

To point `scripts/ops/` at the live control-plane instead of localhost, set in `config/.env`:
```
CONTROL_PLANE_BASE_URL=https://<control-plane-url>
```

---

## 13. Upcoming roadmap

### Immediate (next sessions)
1. **Structured tracing in voice-bridge** — Log per-call fields so I can debug calls autonomously:
   - `trace_id` (UUID or Telnyx `call_control_id`)
   - `tenant_id`, `config_git_sha`, `config_published_at`
   - `fallback_used` (Firestore miss → local → generic)
   - `instructions_length`, `prompt_sources` (which prompt files loaded)
   - Speech events: `speech_started`, `speech_stopped`, `committed`
   - `turn_count_user`, `turn_count_assistant`
   - `latency_ms_first_token`, `latency_ms_response_done`
   - Errors: OpenAI WS errors, tenant not found, secret missing

2. **Point ops scripts at live control-plane** — Set `CONTROL_PLANE_BASE_URL` in `config/.env` so no local server is needed for operator tasks.

3. **Control-plane ingress hardening** — Currently `allow-unauthenticated`. Consider restricting to internal or requiring Cloud IAP.

### Medium term
- **Log query by time window and call-id** — Control-plane `/logs` endpoint should support `?since=` and `?trace_id=` filters.
- **Tenant onboarding automation** — Single command to scaffold a new tenant: create JSON + prompt assets, validate, publish, verify.
- **API key rotation** — Rotate `CONTROL_PLANE_API_KEY` (was exposed in chat history). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Long term vision
The goal is a full **AI-ops loop**:
1. A customer reports a call behaving incorrectly
2. I read logs directly via `tenant-logs.js` — no manual copy-paste
3. I identify the issue (drift, prompt bug, VAD issue, etc.)
4. I propose a Git diff of the prompt/config fix
5. You approve
6. I publish to Firestore — change live on next call
7. I verify via logs after a test call

No UI needed. Claude Code in VS Code IS the ops interface.

---

## 14. Known risks

| Risk | Status | Action |
|------|--------|--------|
| `CONTROL_PLANE_API_KEY` exposed in chat history | Open | Rotate: generate new key, update Secret Manager, update `config/.env` |
| Control-plane `allow-unauthenticated` | Open | Low risk while URL is obscure; harden with Cloud IAP when traffic grows |
| Local GCP auth expires frequently | Known friction | Run `gcloud auth application-default login` when scripts fail with `invalid_grant` |
| Logs filter by `textPayload` string match | Fragile | Improve with structured JSON logging + `jsonPayload.tenant_id` filter |
| No structured call tracing | Gap | See roadmap item 1 above |
