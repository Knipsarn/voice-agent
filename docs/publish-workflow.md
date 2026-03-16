# Tenant Publish Workflow

## Source-of-truth contract

| Layer | Role | Who writes |
|-------|------|------------|
| **Git** (`configs/tenants/*.json`, `configs/prompt-assets/`) | Authoring source of truth | Engineers via PR or direct edit |
| **Firestore** (`tenants/<tenantId>`) | Runtime store — what the bridge reads on every call | `publish-tenant.js` only |
| **`publish-tenant.js`** | The only authorized sync path from Git → Firestore | Intentional operator action |

**Rule:** Every change to a tenant's config or prompts must originate in Git and be pushed to Firestore via `publish-tenant.js`. Firestore is never edited directly except in an emergency hotfix.

---

## Normal operator flow

Use this flow for all routine prompt edits, config changes, and new tenant setup.

### 1. Edit in Git

Edit the relevant files:
- `configs/tenants/<tenantId>.json` — config, voice, entry_mode, feature flags
- `configs/prompt-assets/<tenantId>/*.md` — prompt content (referenced via `$file:`)

### 2. Validate

```bash
node scripts/validate-tenant.js <tenantId>
```

Checks required fields, verifies all `$file:` references resolve, confirms mode/knowledge_block consistency. Fix any errors before continuing.

### 3. Inspect drift (optional but recommended)

```bash
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/diff-tenant.js <tenantId>
```

Shows field-by-field what would change in Firestore. Use this to confirm only intended fields are changing before publishing.

### 4. Publish

```bash
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/publish-tenant.js <tenantId>
```

Resolves all `$file:` references, stamps `_meta` (published_at, git_sha, source: "git"), and writes to Firestore. Takes effect on the next call — no redeploy required.

**Dry-run first if in doubt:**
```bash
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/publish-tenant.js <tenantId> --dry-run
```

---

## Inspection tools

These tools read and display config — they do not write to Firestore.

### Pull live config from Firestore

```bash
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/pull-tenant-from-firestore.js <tenantId>
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/pull-tenant-from-firestore.js <tenantId> --no-meta
```

Shows the exact document the bridge is reading in production, including `_meta`.

### Diff local vs Firestore

```bash
GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/diff-tenant.js <tenantId>
```

Compares local resolved config (Git) against the live Firestore document. Reports match or field-level drift. Use this to detect back-port gaps after hotfixes.

---

## Emergency hotfix flow

Use this only when a prompt must change immediately and there is no time for a Git commit.

1. Edit the tenant document directly in the [Firestore console](https://console.cloud.google.com/firestore/databases/-default-/data/panel/tenants?project=ldk-clean)
2. The runtime will serve the updated config immediately on the next call
3. The runtime will log a warning: `source="hotfix"` — this is expected
4. **Within 24 hours:** back-port the change to Git, then run `publish-tenant.js` to re-stamp the document with `source: "git"`

Skipping the back-port means Git and Firestore are out of sync and the next normal publish will overwrite the hotfix.

---

## Runtime warnings

`FirestoreTenantProvider` logs the following warnings on every call if the loaded document has governance issues:

| Warning | Cause | Action |
|---------|-------|--------|
| `no _meta` | Document published by legacy migration script | Run `publish-tenant.js` to stamp |
| `source="hotfix"` | Document was edited directly in Firestore | Back-port to Git and re-publish |

These warnings never block calls. They are informational only.

---

## What NOT to use

| Script | Status | Use instead |
|--------|--------|-------------|
| `scripts/migrate-tenants-to-firestore.js` | **LEGACY** — does not stamp `_meta` | `publish-tenant.js` |

The migration script is kept for emergency bulk re-seed only. Do not use it as part of the normal workflow.

---

## Onboarding new tenants

Before onboarding new tenants, read this document in full.

The correct flow is:
1. Create `configs/tenants/<tenantId>.json`
2. Create `configs/prompt-assets/<tenantId>/` with prompt files
3. Run `validate-tenant.js` until it passes
4. Run `publish-tenant.js` to push to Firestore
5. Test on the tagged Cloud Run URL before routing live traffic
