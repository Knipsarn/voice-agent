# Build Roadmap

## Phase 0 — done
- prove Telnyx -> Cloud Run -> GPT-Realtime live call works
- validate audio quality

## Phase 1 — next
Turn the current MVP into a multi-tenant bridge.

Required work:
- load tenant config dynamically
- resolve tenant by called number or metadata
- move static prompt/voice into config
- support first message from config
- support direct-to-GPT and PBX-first tenant modes

## Phase 2
Add onboarding scripts.

Required work:
- tenant config validator
- upload audio script
- Firestore writer script
- phone route writer script
- smoke test script

## Phase 3
Add admin/control-plane API.

Required work:
- create tenant API
- update tenant API
- asset listing API
- operations event listing API
- tenant health API

## Phase 4
Add AI-ops layer.

Required work:
- AI-assisted onboarding from uploaded docs
- AI-assisted config editing
- AI-assisted issue triage using logs + tenant config + last deploy info
- AI-generated code changes through Git workflow

## Phase 5
Reduce dependency on manual PBX editing.

Required work:
- centralize more routing into product config
- eventually minimize or replace scattered PBX-specific customizations
