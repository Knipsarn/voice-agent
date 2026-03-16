/**
 * ops/tenant-get.js — Get full Firestore document for a tenant
 * Usage: node scripts/ops/tenant-get.js <tenantId>
 */
const { get, print } = require("./_client");

const tenantId = process.argv[2];
if (!tenantId) { console.error("Usage: node scripts/ops/tenant-get.js <tenantId>"); process.exit(1); }

get(`/tenants/${tenantId}`).then(print).catch(err => { console.error(err.message); process.exit(1); });
