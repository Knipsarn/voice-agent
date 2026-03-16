/**
 * ops/tenant-errors.js — Fetch recent errors for a tenant
 * Usage: node scripts/ops/tenant-errors.js <tenantId> [limit]
 */
const { get, print } = require("./_client");

const tenantId = process.argv[2];
const limit    = process.argv[3] || 20;

if (!tenantId) { console.error("Usage: node scripts/ops/tenant-errors.js <tenantId> [limit]"); process.exit(1); }

get(`/logs/errors?tenantId=${tenantId}&limit=${limit}`).then(print).catch(err => { console.error(err.message); process.exit(1); });
