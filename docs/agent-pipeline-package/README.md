# Autonomous Error-Fix Pipeline — Reusable Package

This package contains two Cloud Run microservices (`error-agent` and `patch-agent`) that form a
fully autonomous error-detection-to-fix pipeline for Node.js applications running on Google Cloud
Run. An AI agent (Claude claude-opus-4-7) reads your source code, investigates production errors, and
either auto-deploys a fix (low-risk) or opens a GitHub PR for human review (medium/high risk).

---

## 1. What the pipeline does

The pipeline has seven steps from error detection to resolution:

1. **Cloud Logging captures errors.** Any log entry at ERROR severity or above from a Cloud Run
   service is captured by Cloud Logging.

2. **Log sink routes to Pub/Sub.** A Cloud Logging sink filters for ERROR+ severity logs from your
   target Cloud Run services and publishes each log entry as a message to a Pub/Sub topic.

3. **Pub/Sub pushes to error-agent.** A push subscription delivers the message (OIDC-authenticated)
   to the `error-agent` Cloud Run service's root POST endpoint.

4. **error-agent stores incident and triggers patch-agent.** The error-agent decodes the
   base64-encoded log entry, extracts service name, severity, message, tenant_id, trace_id, and
   related fields, writes a `new` incident document to Firestore `incidents` collection, then makes
   a fire-and-forget POST to patch-agent's `/patch` endpoint with the incident ID.

5. **patch-agent runs a Claude agentic loop.** Claude receives the incident details and a flat
   listing of all files in the GitHub repo. It uses tools (`read_file`, `search_code`,
   `list_directory`, `search_incidents`) to investigate the error, trace call paths, and check
   incident history. When confident, it calls `propose_patch` with its analysis, the exact file
   changes needed, a risk level (`low` / `medium` / `high`), and a test suggestion.

6. **Low risk: auto-merge and deploy.** If Claude rates the patch `low` risk, patch-agent
   immediately squash-merges the PR via the GitHub API. Cloud Build detects the push to main and
   deploys automatically. The incident status is set to `auto_deployed` and an email alert is sent.

7. **Medium/high risk: PR for human review.** If the risk is `medium` or `high`, patch-agent opens
   the PR but does not merge it. The incident status is set to `patch_proposed` and an email alert
   is sent requesting manual review. Merging the PR triggers Cloud Build to deploy.

---

## 2. Architecture diagram

```
Cloud Logging
     |
     | (ERROR+ severity log entries)
     v
Log Sink (filter: resource.type="cloud_run_revision" AND severity>=ERROR)
     |
     v
Pub/Sub Topic: error-logs
     |
     | (push subscription, OIDC token)
     v
error-agent (Cloud Run)
  POST /
  - decode base64 log entry
  - write incidents/{id} to Firestore  [status: "new"]
  - POST patch-agent/patch {incident_id}
     |
     v
patch-agent (Cloud Run)
  POST /patch
  - read incident from Firestore       [status: "investigating"]
  - fetch repo file tree (GitHub API)
  - run Claude agentic loop:
      read_file / search_code / list_directory / search_incidents
      --> propose_patch {changes, risk, analysis}
  - push branch + open PR (GitHub API)
     |
     +-- risk = low  -----> mergePR() (squash)
     |                      [status: "auto_deployed"]
     |                           |
     |                           v
     |                      Cloud Build trigger
     |                      (push to main -> deploy)
     |
     +-- risk = medium/high --> PR open for review
                                [status: "patch_proposed"]
                                (human merges -> Cloud Build deploys)

Firestore: incidents collection (status lifecycle)
  new -> investigating -> auto_deployed
                       -> patch_proposed
                       -> investigated (no fix possible)
                       -> patch_failed (agent error)

Cloud Scheduler (every 2h)
  POST patch-agent/process-suggestions
     |
     v
  Read prompt_suggestions WHERE status="new"
  For each suggestion:
    - Claude reads tenant config + prompt files
    - propose_prompt_change {changes}
    - push branch + open PR
    - email admin for review
    [status: "pr_created" | "no_change" | "failed"]
```

---

## 3. GCP resources needed

### Pub/Sub

| Resource | Name (example) | Notes |
|---|---|---|
| Topic | `error-logs` | Receives log entries from the sink |
| Subscription | `error-logs-push` | Push type, pushes to error-agent URL |

The push subscription must be configured with:
- **Push endpoint:** `https://<error-agent-url>/`
- **Authentication:** OIDC token, service account with `roles/run.invoker` on error-agent

### Cloud Logging sink

```
gcloud logging sinks create error-logs-sink \
  pubsub.googleapis.com/projects/YOUR_PROJECT/topics/error-logs \
  --log-filter='resource.type="cloud_run_revision"
    AND resource.labels.service_name=("your-service-1" OR "your-service-2")
    AND severity>=ERROR'
```

Grant the sink's writer service account the `pubsub.publisher` role on the topic.

### Cloud Run services

| Service | Source | Port | Min instances |
|---|---|---|---|
| `error-agent-service` | `error-agent/` | 8080 | 1 |
| `patch-agent-service` | `patch-agent/` | 8080 | 0 |

Both services must run with a service account that has:
- `roles/datastore.user` — Firestore read/write
- `roles/secretmanager.secretAccessor` — read secrets

patch-agent is typically not always-on (min instances 0) since it runs short jobs.

### Firestore collections

| Collection | Purpose |
|---|---|
| `incidents` | One document per error incident, full lifecycle tracked here |
| `prompt_suggestions` | Customer/operator-submitted prompt improvement requests |

Both collections are in the default Firestore database. No special indexes are required beyond
Firestore's automatic single-field indexes, except a composite index if you want to filter by both
`service` and `status` simultaneously on `incidents` (Firestore will prompt for this on first query).

### Secret Manager secrets

| Secret name | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | patch-agent | Claude claude-opus-4-7 API key |
| `GITHUB_TOKEN` | patch-agent | Fine-grained PAT: contents (read/write), pull-requests (write), metadata (read) |
| `CONTROL_PLANE_API_KEY` | error-agent (optional) | If you use a control-plane API for additional context |
| `RESEND_API_KEY` | patch-agent | Email alerts via Resend (optional but recommended) |

---

## 4. Environment variables

### error-agent

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `PATCH_AGENT_URL` | Yes | — | Full URL of patch-agent Cloud Run service, e.g. `https://patch-agent-service-xxx.run.app` |
| `GOOGLE_CLOUD_PROJECT` | Yes | `ldk-clean` | GCP project ID for Firestore |

### patch-agent

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key (from Secret Manager) |
| `GITHUB_TOKEN` | Yes | — | GitHub PAT (from Secret Manager) |
| `GOOGLE_CLOUD_PROJECT` | Yes | `ldk-clean` | GCP project ID for Firestore |
| `ADMIN_NOTIFICATION_EMAIL` | No | `nils.wahlin@snmintegrations.se` | Where to send email alerts |
| `ALERT_FROM_EMAIL` | No | `Voice Platform <noreply@snmintegrations.se>` | Sender address for alerts |
| `RESEND_API_KEY` | No | — | Resend API key for email. If absent, alerts are skipped with a warning. |

---

## 5. How Claude auto-merge works

The auto-merge path activates only when Claude rates the patch risk as `low`. The definition of
low risk used in the system prompt is: "isolated change — affects only one clearly bounded code
path, adds a null check or guard, does not touch shared utilities, does not change any config or
build files."

The sequence:

1. Claude calls `propose_patch` with `risk: "low"` and a `changes` array of at most 5 files.
2. patch-agent calls `pushBranchAndPR()` which:
   - Fetches the current `main` SHA via GitHub Git Data API
   - Creates blobs for each changed file
   - Creates a new tree on top of the base tree
   - Creates a commit on that tree
   - Creates a branch ref `fix/auto-<incidentId[:8]>-<timestamp36>`
   - Opens a PR from that branch to `main`
3. patch-agent immediately calls `mergePR()` which squash-merges the PR via:
   `PUT /repos/{owner}/{repo}/pulls/{prNumber}/merge` with `merge_method: "squash"`
4. The squash merge creates a new commit on `main`. Cloud Build's push trigger fires and deploys
   the updated service. No human action is needed.
5. The incident document is updated to `status: "auto_deployed"` and an email is sent with the
   PR link, files changed, analysis, and verification steps.

If `mergePR()` fails (e.g., the PR has a merge conflict or branch protection blocks it), the
exception propagates, the incident is marked `patch_failed`, and an alert is sent.

---

## 6. How the suggestion pipeline works

The suggestion pipeline processes operator or customer requests to improve AI prompts without
requiring a developer to manually edit files.

**Submitting a suggestion:**
Write a document to Firestore `prompt_suggestions` with `status: "new"`:

```json
{
  "tenantId": "your-tenant-id",
  "text": "The receptionist should mention our opening hours at the start of every call",
  "submitted_by": "customer",
  "created_at": "<server timestamp>",
  "status": "new",
  "call_context": {
    "from_number": "+46701234567",
    "initiated_at": "2026-05-05T10:00:00Z",
    "summary": "Caller asked about opening hours twice"
  }
}
```

`call_context` is optional but provides Claude with useful background about what triggered the
suggestion.

**Processing (triggered by Cloud Scheduler every 2h):**

1. Cloud Scheduler POSTs to `patch-agent/process-suggestions`.
2. patch-agent queries `prompt_suggestions WHERE status="new"` ordered by `created_at`, up to 5.
3. For each suggestion, `analyzeAndPatchSuggestion()` runs a Claude loop (max 15 iterations) with
   tools `read_file`, `list_directory`, and `propose_prompt_change`.
4. Claude reads the tenant's config and prompt files, interprets the suggestion, and proposes
   targeted edits to files in `configs/tenants/` or `configs/prompt-assets/` only. It cannot
   touch code files.
5. patch-agent opens a PR with the changes. The suggestion document is updated to `status: "pr_created"`.
6. An email alert is sent for manual review. When the PR is merged, Cloud Build deploys the updated
   prompt automatically.

If Claude determines the suggestion is too vague, contradictory, or would produce no meaningful
improvement, it uses `no_change_reason` instead and the suggestion is marked `no_change`.

---

## 7. The search_incidents tool

Claude does not receive the full incident history upfront. Instead, it calls `search_incidents` as
a tool during its investigation loop, on-demand. This keeps the context window manageable and lets
Claude search purposefully.

**Tool definition:**

```json
{
  "name": "search_incidents",
  "description": "Search the incident history database. Use this before proposing a fix to see if this error has occurred before, what was tried, whether fixes held, and what files were changed.",
  "input_schema": {
    "type": "object",
    "properties": {
      "keyword": {
        "type": "string",
        "description": "Word or phrase to match against error messages and prior analyses"
      },
      "service": {
        "type": "string",
        "description": "Filter to a specific Cloud Run service name"
      },
      "status": {
        "type": "string",
        "description": "Filter by outcome: auto_deployed, patch_failed, patch_proposed, investigated"
      },
      "limit": {
        "type": "number",
        "description": "Max results (default 5, max 20)"
      }
    }
  }
}
```

**Server-side implementation (in patch-agent/index.js):**

The `searchIncidentHistory()` function:
1. Queries Firestore `incidents` ordered by `created_at` desc
2. Applies optional `service` and `status` WHERE filters
3. Fetches up to `limit * 10` documents (wider window for in-memory keyword filtering)
4. Filters out the current incident (by excludeId) and incidents with no useful data
5. Applies keyword filter in memory across `message`, `patch_analysis`, `patch_files_changed`,
   `patch_no_fix_reason` fields
6. Returns up to `limit` formatted summaries

Each result includes: ID, timestamp, service, outcome status, error message snippet, analysis
snippet, files changed, risk level, verification suggestion, and no-fix reason if applicable.

**Typical Claude usage pattern:**

```
1. search_incidents(keyword="Cannot read properties of undefined") 
   -> check if this exact error appeared before
2. search_incidents(service="voice-bridge-service", status="auto_deployed")
   -> check whether prior auto-deploys to this service held
3. [read files, form fix]
4. search_incidents(keyword="tenantLoader")
   -> verify no recent fix to tenantLoader failed
5. propose_patch(...)
```

---

## 8. Firestore incidents document schema

Each incident document is created by error-agent and updated by patch-agent as the job progresses.

| Field | Type | Set by | Description |
|---|---|---|---|
| `timestamp` | string | error-agent | ISO 8601 timestamp from the original log entry |
| `severity` | string | error-agent | `ERROR`, `CRITICAL`, `ALERT`, or `EMERGENCY` |
| `service` | string | error-agent | Cloud Run service name from `resource.labels.service_name` |
| `revision` | string \| null | error-agent | Cloud Run revision name |
| `message` | string | error-agent | Error message, max 5000 chars |
| `trace_id` | string \| null | error-agent | Trace ID from jsonPayload or labels |
| `tenant_id` | string \| null | error-agent | Tenant ID if present in structured log |
| `log_trace` | string \| null | error-agent | Cloud Trace ID from the log entry |
| `log_insert_id` | string \| null | error-agent | Cloud Logging insertId for deduplication |
| `raw_event` | object | error-agent | Stripped jsonPayload fields (strings capped at 1000 chars) |
| `created_at` | Timestamp | error-agent | Firestore server timestamp |
| `status` | string | both | Lifecycle: `new` -> `investigating` -> `auto_deployed` / `patch_proposed` / `investigated` / `patch_failed` |
| `patch_started_at` | Timestamp | patch-agent | When patch-agent began investigating |
| `patch_completed_at` | Timestamp | patch-agent | When patch-agent finished (any outcome) |
| `patch_analysis` | string | patch-agent | Claude's root cause analysis |
| `patch_result` | string | patch-agent | `auto_merged`, `pr_created`, `no_fix` |
| `patch_risk` | string | patch-agent | `low`, `medium`, or `high` |
| `patch_pr_url` | string | patch-agent | GitHub PR URL |
| `patch_pr_number` | number | patch-agent | GitHub PR number |
| `patch_branch` | string | patch-agent | Git branch name for the fix |
| `patch_files_changed` | string | patch-agent | Comma-separated list of changed file paths |
| `patch_test_suggestion` | string \| null | patch-agent | Claude's suggested verification steps |
| `patch_iterations` | number | patch-agent | How many agentic loop iterations Claude used |
| `patch_no_fix_reason` | string | patch-agent | If no fix: why Claude could not propose one |
| `patch_error` | string | patch-agent | If `status: "patch_failed"`: the exception message |

---

## 9. How to adapt to a new project

The following changes are required to deploy this pipeline in a different project:

### github.js

```js
const OWNER = "YourGitHubOrg";       // was: "Knipsarn"
const REPO  = "your-repo-name";      // was: "voice-agent"
const BASE_BRANCH = "main";          // keep or change to "master" etc.
```

### claude-agent.js — system prompt

Replace the platform overview section to describe your actual services:

```
## Platform overview
- Node.js microservices on Google Cloud Run (YOUR_REGION, project YOUR_PROJECT)
- your-service: description
- Firestore: collections used
- Config source-of-truth: describe your config pattern
```

Update the "Key files to know" section to list the most important files in your repo so Claude
starts in the right place.

### error-agent/index.js

Change the default project ID if needed:
```js
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "your-project-id";
```

### patch-agent/index.js

Change the default project ID and notification email:
```js
const PROJECT      = process.env.GOOGLE_CLOUD_PROJECT || "your-project-id";
const ADMIN_EMAIL  = process.env.ADMIN_NOTIFICATION_EMAIL || "you@yourcompany.com";
const ALERT_FROM   = process.env.ALERT_FROM_EMAIL || "Platform <noreply@yourcompany.com>";
```

### Cloud Logging sink filter

Update the service name list to match your Cloud Run services:
```
resource.type="cloud_run_revision"
AND resource.labels.service_name=("your-service-1" OR "your-service-2")
AND severity>=ERROR
```

### Firestore project

Set `GOOGLE_CLOUD_PROJECT` env var on both Cloud Run services (or via Secret Manager reference).
Firestore uses the default database; no collection names need to change unless you want different
names.

### claude-suggestion-agent.js

If your project does not use prompt files stored in Git, remove or replace this agent entirely.
If it does, update the system prompt's "Platform context" section and the file path conventions
(`configs/tenants/`, `configs/prompt-assets/`) to match your structure.

### Email provider

The pipeline uses Resend (`https://api.resend.com/emails`). To use a different provider, replace
the `sendPatchAlert()` function in `patch-agent/index.js`. The function signature is:
```js
async function sendPatchAlert({ subject, text }) { ... }
```

---

## 10. Security notes

### OIDC for Pub/Sub push authentication

The Pub/Sub push subscription is configured with OIDC token authentication. The token is generated
by Google using a service account you specify when creating the subscription. This service account
must have `roles/run.invoker` on the error-agent Cloud Run service.

error-agent does not verify the OIDC token itself — Cloud Run's built-in IAM policy does. If you
set the Cloud Run service to "require authentication", only Pub/Sub (with the correct service
account) can call it. Do not make error-agent unauthenticated unless you add your own token
verification.

To configure the push subscription with OIDC:
```
gcloud pubsub subscriptions create error-logs-push \
  --topic=error-logs \
  --push-endpoint=https://error-agent-url/ \
  --push-auth-service-account=pubsub-invoker@YOUR_PROJECT.iam.gserviceaccount.com
```

### API key for control-plane calls

If error-agent or patch-agent need to call your own control-plane API (for tenant lookups,
additional context, etc.), use `CONTROL_PLANE_API_KEY` stored in Secret Manager. Pass it as a
`Bearer` token in the `Authorization` header. Never hardcode API keys in source files.

### GitHub token scope

The `GITHUB_TOKEN` used by patch-agent must be a fine-grained personal access token (not a
classic token) with:
- Repository: **Contents** — read and write (to push branches and read files)
- Repository: **Pull requests** — write (to open and merge PRs)
- Repository: **Metadata** — read (required for all fine-grained tokens)

Limit the token to the specific repository. Rotate it annually (or sooner). Store it in Secret
Manager, not in env var literals.

### Anthropic API key

`ANTHROPIC_API_KEY` grants access to Claude claude-opus-4-7, which is a relatively expensive model.
Store it in Secret Manager. Monitor your Anthropic usage dashboard; a runaway agentic loop (bug in
MAX_ITERATIONS guard) could generate unexpected costs. The current limit is 20 iterations per
incident.

### patch-agent internal network access

patch-agent calls error-agent at `PATCH_AGENT_URL`. If both services are in the same VPC or same
GCP project, you can use VPC-internal URLs. If using public URLs, the call is unauthenticated by
default in the current implementation. For production, add a shared secret header check or use
service-to-service OIDC authentication (`Authorization: Bearer $(gcloud auth print-identity-token)`
pattern).

---

## 11. Testing checklist

Use this checklist to verify the pipeline end-to-end after deploying to a new project.

### Infrastructure

- [ ] Pub/Sub topic `error-logs` exists
- [ ] Push subscription `error-logs-push` points to the correct error-agent URL
- [ ] Push subscription has OIDC auth configured with correct service account
- [ ] Cloud Logging sink `error-logs-sink` exists and filter matches your services
- [ ] Sink writer service account has `pubsub.publisher` on the topic
- [ ] error-agent Cloud Run service is deployed and healthy (`GET /health` returns `{"status":"ok"}`)
- [ ] patch-agent Cloud Run service is deployed and healthy (`GET /health` returns `github: true, anthropic: true`)
- [ ] Both services can reach Firestore (check IAM: `datastore.user`)
- [ ] Both services can read secrets (check IAM: `secretmanager.secretAccessor`)
- [ ] `PATCH_AGENT_URL` env var on error-agent points to patch-agent

### Pub/Sub delivery

- [ ] Manually publish a test message to the topic:
  ```
  gcloud pubsub topics publish error-logs \
    --message='{"severity":"ERROR","resource":{"labels":{"service_name":"test-service"}},"textPayload":"test error for pipeline verification"}'
  ```
- [ ] Verify error-agent logs show "stored incident" within 30 seconds
- [ ] Verify an `incidents` document with `status: "new"` appears in Firestore

### Patch job

- [ ] Verify patch-agent logs show "Starting patch job" shortly after incident creation
- [ ] Verify incident document transitions to `status: "investigating"`
- [ ] Verify Claude's tool calls appear in patch-agent logs (read_file, search_incidents, etc.)
- [ ] Verify the incident reaches a terminal status: `auto_deployed`, `patch_proposed`, `investigated`, or `patch_failed`
- [ ] If `auto_deployed`: verify the PR was squash-merged on GitHub and Cloud Build triggered
- [ ] If `patch_proposed`: verify the PR exists on GitHub and is open
- [ ] Verify an email alert was sent to the admin address

### Suggestion pipeline

- [ ] Write a test document to Firestore `prompt_suggestions`:
  ```json
  {
    "tenantId": "test-tenant",
    "text": "Test suggestion for pipeline verification",
    "submitted_by": "tester",
    "status": "new",
    "created_at": <server timestamp>
  }
  ```
- [ ] POST to `patch-agent/process-suggestions` manually (or wait for scheduler)
- [ ] Verify suggestion document transitions to `status: "processing"` then `pr_created` or `no_change`
- [ ] Verify email alert received

### Auto-merge guard

- [ ] Review patch-agent logs for a `risk: "low"` incident and confirm `mergePR()` was called
- [ ] Confirm Cloud Build triggered and deployed within ~5 minutes of the merge
- [ ] Confirm incident status is `auto_deployed` with `patch_pr_url` populated

### Failure handling

- [ ] Set `GITHUB_TOKEN` to an invalid value temporarily and trigger a patch job
- [ ] Confirm incident transitions to `patch_failed` with a meaningful `patch_error` message
- [ ] Restore the correct token

---

## File listing

```
docs/agent-pipeline-package/
  README.md                            — this file
  error-agent/
    index.js                           — Pub/Sub push handler, incident creation
    package.json                       — dependencies: express, @google-cloud/firestore
    Dockerfile                         — node:20-slim, npm ci --omit=dev
  patch-agent/
    index.js                           — POST /patch and /process-suggestions entrypoints
    claude-agent.js                    — error-fix agentic loop (claude-opus-4-7, max 20 iter)
    claude-suggestion-agent.js         — prompt-suggestion agentic loop (claude-opus-4-7, max 15 iter)
    github.js                          — GitHub REST + Git Data API client
    package.json                       — dependencies: express, @anthropic-ai/sdk, @google-cloud/firestore
    Dockerfile                         — node:20-slim, npm ci --omit=dev
```
