/**
 * ops/tenant-errors.js — Fetch recent errors for a tenant
 * Usage: node scripts/ops/tenant-errors.js <tenantId> [limit]
 */
const { get, print, handleError } = require("./_client");

const tenantId = process.argv[2];
const limit    = process.argv[3] || 20;

if (!tenantId) { console.error("Usage: node scripts/ops/tenant-errors.js <tenantId> [limit]"); process.exit(1); }

get(`/logs/tenant/${tenantId}/errors?limit=${limit}`).then(print).catch(handleError);
