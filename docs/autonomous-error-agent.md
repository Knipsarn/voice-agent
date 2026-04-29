# Autonomous Error-Fix Agent — Infrastructure Overview

## What it does

When any production service throws an ERROR-level log, the platform automatically:
1. Captures the error
2. Invokes Claude (claude-opus-4-7) with full access to the codebase
3. If Claude determines it's a real bug: pushes a fix branch and opens a GitHub PR
4. Dashboard shows the PR — you review and merge
5. Merging triggers Cloud Build to auto-deploy

You do not need to be at the computer. The agent works autonomously 24/7.

---

## Architecture

```
Production Cloud Run service throws ERROR
        │
        ▼
Cloud Logging (sink: error-sink)
  Filter: severity >= ERROR
  Services: voice-bridge, control-plane, telephony, post-processor
        │
        ▼
Pub/Sub topic: voice-platform-errors
        │
        ▼ (push subscription with OIDC auth)
error-agent-service (Cloud Run)
  • Decodes the log entry
  • Stores raw incident in Firestore: incidents/<auto-id>
  • status: "new"
        │
        ▼ (async HTTP POST, no wait)
patch-agent-service (Cloud Run)
  • Reads incident from Firestore
  • Fetches full repo file tree from GitHub API
  • Runs Claude agentic loop:
      - Claude reads files it needs (read_file, list_directory, search_code)
      - Claude decides: transient error OR real bug
      - If transient: marks incident "investigated", explains why, stops
      - If real bug: reads affected files, traces call paths, proposes fix
      - Calls propose_patch with complete file contents to change
  • Pushes branch: fix/auto-{incident-id}
  • Opens GitHub PR with full analysis + risk level
  • Updates Firestore incident: status "patch_proposed" + PR link
        │
        ▼
Dashboard: /admin/incidents
  Shows incident + PR link + analysis + risk badge
        │
        ▼ (you review and merge)
GitHub PR merged
        │
        ▼
Cloud Build trigger (push to main)
  Rebuilds and deploys the affected service
```

---

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| `error-agent-service` | `https://error-agent-service-360579353014.europe-west1.run.app` | Pub/Sub handler, incident storage |
| `patch-agent-service` | `https://patch-agent-service-360579353014.europe-west1.run.app` | Claude investigation + PR creation |

Both on Cloud Run, `europe-west1`, project `ldk-clean`.

---

## GCP Infrastructure

### Cloud Logging sink: `error-sink`
- **Filter:** `resource.type="cloud_run_revision" AND severity>=ERROR`
- **Covered services:** voice-bridge-service, control-plane-service, telephony-service, post-processor-service
- **Destination:** Pub/Sub topic `voice-platform-errors`
- **Writer SA:** `service-360579353014@gcp-sa-logging.iam.gserviceaccount.com` (auto-created by GCP)

### Pub/Sub topic: `voice-platform-errors`
- Receives one message per ERROR log entry from any covered service
- Message format: Cloud Logging log entry JSON, base64-encoded

### Pub/Sub subscription: `voice-platform-errors-to-agent`
- **Type:** Push (HTTP POST to error-agent-service)
- **Auth:** OIDC token minted by `error-agent-invoker@ldk-clean.iam.gserviceaccount.com`
- **Ack deadline:** 60s
- **Message retention:** 7 days

### Firestore collection: `incidents`
- One document per error incident
- Fields: `timestamp`, `severity`, `service`, `message`, `trace_id`, `tenant_id`, `status`, and patch fields

---

## Firestore Incident Lifecycle

| Status | Meaning |
|--------|---------|
| `new` | Stored by error-agent, patch-agent job queued |
| `investigating` | Claude is actively reading the codebase |
| `investigated` | Claude determined no code fix needed (transient error) |
| `patch_proposed` | PR opened on GitHub — awaiting your review |
| `patch_failed` | Agent encountered an error during investigation |
| `acknowledged` | You manually acknowledged |
| `resolved` | Fixed (manually or via merged PR) |
| `ignored` | Marked as expected/non-actionable |

### Patch fields (added when patch_result is set)
| Field | Value |
|-------|-------|
| `patch_pr_url` | GitHub PR URL |
| `patch_pr_number` | PR number |
| `patch_branch` | `fix/auto-{id}` branch name |
| `patch_analysis` | Claude's root cause explanation |
| `patch_risk` | `low` / `medium` / `high` |
| `patch_test_suggestion` | How to verify the fix |
| `patch_files_changed` | Comma-separated list of changed files |
| `patch_iterations` | Number of file reads Claude performed |

---

## Secrets (Secret Manager, project: ldk-clean)

| Secret | Used by | Purpose |
|--------|---------|---------|
| `OPENAI_API_KEY` | voice-bridge, error-agent | OpenAI Realtime API |
| `TELNYX_API_KEY` | voice-bridge | Telnyx call control |
| `CONTROL_PLANE_API_KEY` | all services | Control-plane auth |
| `ANTHROPIC_API_KEY` | patch-agent | Claude API (claude-opus-4-7) |
| `GITHUB_TOKEN` | patch-agent | Read repo + push branches + open PRs |
| `OPERATOR_SA_KEY` | (blocked by org policy, not used) | — |

### GitHub Token
- **Token name:** `agent.acess`
- **Repo:** `Knipsarn/voice-agent`
- **Permissions:** `contents: write`, `pull_requests: write`, `metadata: read`
- **Expiry:** 2026-05-29 — **must be renewed before this date**
- **Renewal:** Generate new fine-grained PAT at github.com → Settings → Developer settings → Personal access tokens, then: `gcloud secrets versions add GITHUB_TOKEN --data-file=- --project=ldk-clean`

---

## Claude Agent — How it investigates

The patch-agent runs an agentic loop using the Anthropic SDK with tool use. Claude is given:
- The full incident (error message, service, severity, tenant, trace ID)
- A list of all file paths in the repo (~500 files)
- The platform architecture description (same as CLAUDE.md)

Claude then calls tools to investigate:

| Tool | What it does |
|------|-------------|
| `read_file(path)` | Fetches file content from GitHub API |
| `list_directory(dir)` | Lists files under a directory |
| `search_code(query)` | GitHub code search across the repo |
| `propose_patch(...)` | Final tool — specifies file changes, terminates the loop |

**Limits:** Max 20 iterations, max 5 files changed per patch.

**Triage logic:** Claude first decides if the error is transient (network blip, API timeout, cold-start) or a real bug. Transient errors get a "no fix needed" explanation without opening a PR. Only real bugs result in code changes.

---

## PR Structure

Each auto-generated PR includes:
- The error message and incident ID
- Claude's root cause analysis
- A list of changed files with reasons
- Risk assessment (low / medium / high)
- Instructions for how to verify the fix
- A note that merging triggers CI/CD deployment

Branch naming: `fix/auto-{incident-id-prefix}-{timestamp}`

---

## What gets monitored

All four production services are covered:
- **voice-bridge-service** — call handling, OpenAI session, tenant loading
- **control-plane-service** — operator API, tenant CRUD
- **telephony-service** — Telnyx webhook gateway, call routing
- **post-processor-service** — post-call summarization

The dashboard service is not included (runs Next.js, errors show in browser console, not Cloud Logging ERROR level).

---

## Adding error-agent to a new service

To add coverage for a new Cloud Run service, update the logging sink filter:

```bash
gcloud logging sinks update error-sink \
  "pubsub.googleapis.com/projects/ldk-clean/topics/voice-platform-errors" \
  --log-filter='resource.type="cloud_run_revision"
AND (resource.labels.service_name="voice-bridge-service"
     OR resource.labels.service_name="control-plane-service"
     OR resource.labels.service_name="telephony-service"
     OR resource.labels.service_name="post-processor-service"
     OR resource.labels.service_name="YOUR-NEW-SERVICE")
AND severity>=ERROR' \
  --project=ldk-clean
```

---

## Maintenance

| Task | When | How |
|------|------|-----|
| Renew GitHub token | Before 2026-05-29 | New fine-grained PAT → `gcloud secrets versions add GITHUB_TOKEN` |
| Refresh gcloud auth | When `invalid_grant` errors appear | `bash scripts/ops/auth.sh` |
| Adjust Claude model | When newer model available | Edit `MODEL` const in `apps/patch-agent/claude-agent.js` |
| Adjust covered services | New service added | Update `error-sink` filter (see above) |
