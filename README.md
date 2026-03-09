# AI Voice Platform — Handoff Pack

This folder is a structured handoff pack for another AI model or developer.

## Goal
Build a scalable, multi-tenant AI voice platform where:
- one shared runtime handles many customer phone numbers
- each customer is configured by data, not new services
- Telnyx handles telephony
- OpenAI GPT-Realtime handles live voice conversation
- Google Cloud hosts runtime and stores config/assets
- GitHub stores code and version history
- onboarding a new customer should mostly mean adding tenant data + assets

## Current status
- A working MVP bridge already exists and was successfully deployed to Cloud Run.
- The MVP proves Telnyx -> Cloud Run -> GPT-Realtime -> PSTN works with good audio quality.
- The next step is to convert the MVP into a multi-tenant, config-driven product.

## Recommended read order
1. `docs/01-product-overview.md`
2. `docs/02-current-state.md`
3. `docs/03-target-architecture.md`
4. `docs/04-runtime-flows.md`
5. `docs/05-data-model.md`
6. `docs/06-repository-structure.md`
7. `docs/07-onboarding-and-ops.md`
8. `docs/08-secrets-and-environments.md`
9. `docs/09-build-roadmap.md`
10. `docs/10-ai-agent-brief.md`

## Included extras
- Current MVP bridge code: `apps/voice-bridge/index.js`
- Example tenant config: `config/examples/tenant.example.json`
- Suggested env template: `config/examples/.env.example`
