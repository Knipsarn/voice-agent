/**
 * ops/tenant-publish.js — Publish local tenant config to Firestore via control-plane
 * Usage: node scripts/ops/tenant-publish.js <tenantId> [--dry-run]
 *
 * Always diff first: node scripts/ops/tenant-diff.js <tenantId>
 */
const { post, print } = require("./_client");

const tenantId = process.argv[2];
const dryRun   = process.argv.includes("--dry-run");

if (!tenantId) { console.error("Usage: node scripts/ops/tenant-publish.js <tenantId> [--dry-run]"); process.exit(1); }

post(`/tenants/${tenantId}/publish`, { dry_run: dryRun })
  .then(print)
  .catch(err => { console.error(err.message); process.exit(1); });
