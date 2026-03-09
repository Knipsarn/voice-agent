# AI Agent Brief

## Role
You are helping build a scalable multi-tenant AI voice platform.

## What already exists
- a working Cloud Run voice bridge for Telnyx <-> OpenAI GPT-Realtime
- a successful proof of audio quality and live call functionality
- a strategic decision to avoid one service per customer

## What must be preserved
- one shared runtime where possible
- customer differences should be stored as data, not runtime forks
- support both direct-to-GPT and PBX-first behavior
- onboarding should become mostly config + assets

## High-priority build task
Convert the current single-tenant MVP into a multi-tenant bridge and add the minimum data model required to support multiple customers.

## Implementation priorities
1. keep current working bridge stable
2. add tenant lookup
3. add Firestore-backed tenant config loading
4. add first message support
5. add config-driven voice and instructions
6. support both direct-to-GPT and PBX-first tenants

## Constraints
- do not create one Cloud Run service per customer
- do not hardcode tenant behavior directly in bridge source
- do not store secrets in repo files
- keep the platform simple enough for a non-developer founder to operate

## Desired developer experience
The founder should be able to work mainly from VS Code and GitHub.
The platform should be operable without living inside the Google Cloud Console.

## Future AI-ops goal
The platform should eventually support:
- AI-assisted onboarding
- AI-assisted config changes
- AI-assisted issue diagnosis
- revision-aware fixes and rollback support

## Immediate coding target
Start by refactoring the current bridge into:
- tenant-aware runtime
- config loader
- first-message support
- maintainable project structure
