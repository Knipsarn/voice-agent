# Target Architecture

## Core principle
One platform, many tenants.

## Main components
### 1. Cloud Run — voice bridge
Purpose:
- accept Telnyx WebSocket media streaming
- open GPT-Realtime session
- load tenant config
- apply session instructions, voice, and first message
- route state and mode changes during a live call

### 2. PBX router
Purpose:
- receive Telnyx call event webhooks
- perform pre-call logic when needed
- optionally start Telnyx media streaming to the bridge
- support both direct-to-GPT and PBX-first tenants

This can stay in n8n initially.

### 3. Firestore
Purpose:
- store tenant configuration
- store agent configuration blocks
- store feature flags and routing preferences
- optionally store recent call/session state metadata

### 4. Cloud Storage
Purpose:
- store customer-specific audio assets
- intro audio
- voicemail audio
- other reusable files

### 5. GitHub repository
Purpose:
- single source of truth for code
- version control
- AI-assisted code changes
- PR/review/rollback workflow
- onboarding scripts and config templates

### 6. Optional admin API / control plane
Purpose:
- create tenants
- upload assets
- update prompts
- inspect recent logs and tenant status
- eventually power an internal chat-style operator interface

## Tenant resolution options
At runtime, the bridge or PBX must determine which tenant a call belongs to.

Supported resolution methods:
1. Called phone number (`to` number) -> tenant lookup
2. Telnyx `client_state` -> tenant lookup
3. Dedicated path, example `/tenant/<tenant_id>`
4. PBX router passes explicit tenant metadata

Recommended order:
- primary: called number lookup
- secondary: explicit tenant metadata

## Why this is scalable
Because customer-specific behavior is config-driven:
- same runtime
- same bridge code
- same PBX structure
- same deploy target
- different tenant data
