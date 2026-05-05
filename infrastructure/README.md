# Infrastructure

Scripts for setting up and understanding the full GCP infrastructure.

## setup.sh

Recreates the entire GCP stack from scratch. Run this when:
- Starting fresh in a new GCP project
- Onboarding a new environment (staging, prod)
- After a disaster recovery

```bash
chmod +x infrastructure/setup.sh
./infrastructure/setup.sh
```

Override defaults:
```bash
PROJECT=my-project REGION=europe-west1 ./infrastructure/setup.sh
```

## What exists in production (ldk-clean)

### Cloud Run Services
| Service | Concurrency | Purpose |
|---------|-------------|---------|
| `voice-bridge-service` | 1 (one call per instance) | Telnyx ↔ OpenAI Realtime bridge |
| `control-plane-service` | 80 | Operator API: tenants, billing, SMS, incidents |
| `telephony-service` | 80 | Telnyx webhook gateway, routes calls by number |
| `post-processor-service` | 80 | Summarizes completed calls via gpt-4o-mini |
| `dashboard-service` | 80 | Next.js customer + admin dashboard |
| `error-agent-service` | 80 | Classifies errors, creates incidents, triggers patch-agent |
| `patch-agent-service` | 4 | Claude agentic loop, proposes/deploys code fixes |

### Cloud Scheduler Jobs
| Job | Schedule | Endpoint | Auth |
|-----|----------|----------|------|
| `post-processor-pending` | Every minute | POST /process-pending | None |
| `enkla-juridik-sms-reminders` | Every 2h (07:30–19:30) | POST /sms/reminders/run | Bearer |
| `pipefy-auto-sync` | Every 4h | POST /pipefy/auto-sync | Bearer |
| `prompt-suggestion-processor` | Every 2h (08:00–20:00) | POST /process-suggestions | None |

### Pub/Sub
| Resource | Value |
|----------|-------|
| Topic | `voice-platform-errors` |
| Subscription | `voice-platform-errors-to-agent` |
| Push endpoint | `error-agent-service/` |
| Push auth | OIDC via `error-agent-invoker` service account |

### Log Sink
- Name: `error-sink`
- Filter: ERROR+ severity from all Cloud Run services
- Destination: `voice-platform-errors` Pub/Sub topic

### Secret Manager
All secrets stored here — services mount via `--set-secrets` in cloudbuild.yaml files.

| Secret | Used by |
|--------|---------|
| `OPENAI_API_KEY` | voice-bridge, post-processor, control-plane (SMS parser) |
| `ANTHROPIC_API_KEY` | patch-agent |
| `CONTROL_PLANE_API_KEY` | All services calling control-plane |
| `TELNYX_API_KEY` | voice-bridge (hangup/transfer), telephony |
| `TELNYX_PUBLIC_KEY` | telephony (webhook validation) |
| `GITHUB_TOKEN` | patch-agent (creates PRs, merges) |
| `ELK_API_USER` / `ELK_API_PASS` | control-plane (46elks SMS) |
| `ELK_FROM_NUMBER` | control-plane (SMS sender number) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | dashboard (NextAuth) |
| `NEXTAUTH_SECRET` | dashboard |
| `FORTNOX_CLIENT_ID` / `FORTNOX_CLIENT_SECRET` | dashboard + control-plane |
| `RESEND_API_KEY` | control-plane (email alerts) |

### Firestore
- Database: `(default)`, Native mode, `europe-west1`
- Indexes: defined in `firestore.indexes.json` at repo root

### CI/CD
4 Cloud Build triggers, all on push to `main`:
- `deploy-voice-bridge` → `cloudbuild.yaml`
- `deploy-control-plane` → `cloudbuild.control-plane.yaml`
- `deploy-dashboard` → `cloudbuild.dashboard.yaml`
- `deploy-telephony` → `cloudbuild.telephony.yaml`
