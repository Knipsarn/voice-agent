/**
 * ops/tenant-diff.js — Field-level diff: local config vs live Firestore
 * Usage: node scripts/ops/tenant-diff.js <tenantId>
 */
const { get, print } = require("./_client");

const tenantId = process.argv[2];
if (!tenantId) { console.error("Usage: node scripts/ops/tenant-diff.js <tenantId>"); process.exit(1); }

get(`/tenants/${tenantId}/diff`).then(print).catch(err => { console.error(err.message); process.exit(1); });
