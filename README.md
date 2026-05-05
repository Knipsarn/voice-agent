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

## Building philosophy

This project is built as modular lego pieces. Follow these rules when extending it:

**1. Package every reusable integration.**
Any integration that another project could use (auth, payments, SMS, invoicing) goes in `docs/` as a self-contained package with actual file contents + a README an AI can follow without touching this repo. If you have to say "the file is at apps/..." when handing it off, it's not packaged yet.

**2. Infrastructure as code — nothing manual without documentation.**
Every GCP resource (Cloud Run, Scheduler, Pub/Sub, secrets, log sinks) must be reflected in `infrastructure/setup.sh`. Update the script in the same commit as the resource. If the stack can't be recreated from `setup.sh`, it's not documented.

**3. Data not code.**
Tenant differences live in `configs/` — never as if-statements keyed on tenant ID in application code. All tenant behaviour is expressed as config data published to Firestore.

**4. Safety-first deployment.**
- Tenant configs: `diff` → `--dry-run` → `publish` → live on next call, no redeploy
- Code: minimal change → commit → Cloud Build auto-deploys
- Patches: `risk=low` auto-merges, `risk=medium/high` opens PR for human review

**5. Discuss before fix.**
Read logs and source first. State findings and proposed fix together. Only implement after the user confirms — unless it's a single obvious config value with a clear cause.

**6. Claude Code is the operator.**
Claude Code can read logs, publish configs, commit code, create GCP resources, and investigate errors. It operates proactively — forms a complete picture before presenting findings, not step by step.

Full details: **`CLAUDE.md` section 15 — Building philosophy**.

---

## Day-to-day operations

See **`CLAUDE.md`** — full operator manual with error playbooks, publish workflows, and debugging guides.
