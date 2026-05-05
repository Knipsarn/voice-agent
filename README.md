# AI Voice Platform

Multitenant AI voice agent platform. Businesses get a phone number answered by a custom AI agent. Built on Telnyx, OpenAI Realtime API, and Google Cloud Run.

## How it works

```
Caller → Telnyx → telephony-service → voice-bridge-service → OpenAI Realtime
                                             ↓
                                     post-processor-service (summary)
                                             ↓
                                     control-plane-service (API)
                                             ↓
                                     dashboard-service (UI)
```

One shared Cloud Run stack serves all tenants. **Tenant differences = data, not code.**

---

## Repository structure

```
apps/
├── voice-bridge/        Core call handler. Bridges Telnyx ↔ OpenAI Realtime.
├── control-plane/       Operator API. Tenants, billing, SMS, incidents, Fortnox.
├── telephony/           Telnyx webhook gateway. Routes calls by destination number.
├── post-processor/      Summarizes completed calls via gpt-4o-mini.
├── dashboard/           Next.js customer + admin UI. NextAuth Google sign-in.
├── error-agent/         Monitors Cloud Logging. Classifies errors, creates incidents.
└── patch-agent/         Claude agentic loop. Proposes and auto-deploys code fixes.

configs/
├── tenants/             Tenant configs — Git source-of-truth (published → Firestore)
└── prompt-assets/       Prompt files referenced via $file: in tenant configs

docs/
├── fortnox-package/     Reusable Fortnox OAuth2 + invoicing integration
├── agent-pipeline-package/  Reusable autonomous error-fix pipeline
└── sms-package/         Reusable 46elks SMS integration

infrastructure/
├── setup.sh             Recreates full GCP stack from scratch
└── README.md            Infrastructure reference (all resources, secrets, jobs)

scripts/ops/             Operator shell — wraps control-plane API for daily use
firestore.indexes.json   Firestore composite indexes (source of truth)
CLAUDE.md                Full operator manual — start here for day-to-day ops
```

---

## Services at a glance

| Service | Key env vars |
|---------|-------------|
| voice-bridge | OPENAI_API_KEY, TELNYX_API_KEY, CONTROL_PLANE_API_KEY |
| control-plane | OPENAI_API_KEY, ELK_*, FORTNOX_*, CONTROL_PLANE_API_KEY |
| telephony | TELNYX_PUBLIC_KEY, CONTROL_PLANE_API_KEY |
| post-processor | OPENAI_API_KEY, CONTROL_PLANE_API_KEY |
| dashboard | GOOGLE_CLIENT_*, NEXTAUTH_SECRET, CONTROL_PLANE_API_KEY, FORTNOX_* |
| error-agent | ANTHROPIC_API_KEY, CONTROL_PLANE_API_KEY |
| patch-agent | ANTHROPIC_API_KEY, GITHUB_TOKEN, CONTROL_PLANE_API_KEY |

---

## Tenant config system

```
Git (configs/tenants/*.json)  ──publish──▶  Firestore (tenants/<id>)  ──read──▶  voice-bridge
```

- **Git** is the authoring source. Edit JSON + prompt files here.
- **Firestore** is the runtime source. Bridge reads at call start.
- Changes take effect on the **next call** — no redeploy needed.

```bash
node scripts/ops/tenant-diff.js <id>           # see what's changed
node scripts/ops/tenant-publish.js <id>        # push to Firestore
node scripts/ops/tenant-calls.js <id>          # recent calls
node scripts/ops/tenant-replay.js <id>         # dialogue transcript
```

---

## Autonomous error pipeline

```
Cloud Logging (ERROR) → Pub/Sub → error-agent → incident created
                                                       ↓
                                                patch-agent + Claude
                                                       ↓
                               risk=low  → auto-merge PR → Cloud Build → deployed
                               risk=high → PR opened → manual review
```

Every ERROR from Cloud Run triggers this pipeline. Claude investigates source code, checks incident history, proposes a fix, and deploys it if low-risk — no human needed.

See `docs/agent-pipeline-package/` for the full reusable package.

---

## Reusable integration packages

Self-contained packages with actual code + implementation guides. Load into any AI to implement in a new project.

| Package | What it does |
|---------|--------------|
| `docs/fortnox-package/` | Fortnox OAuth2, customer picker, invoice creation/sending |
| `docs/agent-pipeline-package/` | Claude auto-fixes production errors, opens PRs, auto-deploys |
| `docs/sms-package/` | 46elks outbound SMS, inbound parsing, reminders, cost tracking |

---

## Infrastructure

Full GCP setup: `infrastructure/README.md`
Recreate from scratch: `./infrastructure/setup.sh`

---

## Current tenants

| Tenant | Voice | Phone |
|--------|-------|-------|
| enkla-juridik | marin | +46105201287 |
| alvsjo-tandvard | marin | +46105201311 |

---

## Day-to-day operations

See **`CLAUDE.md`** — full operator manual with error playbooks, publish workflows, and debugging guides.
