# Suggested Repository Structure

```text
repo-root/
  README.md
  docs/
    01-product-overview.md
    02-current-state.md
    03-target-architecture.md
    04-runtime-flows.md
    05-data-model.md
    06-repository-structure.md
    07-onboarding-and-ops.md
    08-secrets-and-environments.md
    09-build-roadmap.md
    10-ai-agent-brief.md
  apps/
    voice-bridge/
      index.js
      package.json
      README.md
    admin-api/
      (future)
  config/
    examples/
      tenant.example.json
      .env.example
    tenants/
      (local non-secret tenant definitions for onboarding drafts)
  scripts/
    onboard-tenant.ts
    update-tenant.ts
    upload-audio.ts
    check-tenant.ts
  infra/
    cloud-run/
    firestore/
    storage/
  prompts/
    base/
    modes/
    tenant-templates/
```

## What belongs where
### apps/voice-bridge
Live runtime code for the WebSocket bridge.

### config/examples
Reference templates for new tenants and environment setup.

### scripts
Automation scripts used from VS Code or terminal.

### infra
Infrastructure definitions or helper docs.

### prompts
Reusable prompt blocks and tenant templates.

## Why GitHub matters
GitHub should hold:
- all runtime code
- all templates
- onboarding scripts
- deployment config
- documentation for AI-assisted development

New tenants should not require code changes unless the platform itself needs new behavior.
