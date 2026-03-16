/**
 * ops/tenant-meta.js — Show _meta stamp for a tenant (published_at, git_sha, source)
 * Usage: node scripts/ops/tenant-meta.js <tenantId>
 */
const { get, print, handleError } = require("./_client");

const tenantId = process.argv[2];
if (!tenantId) { console.error("Usage: node scripts/ops/tenant-meta.js <tenantId>"); process.exit(1); }

get(`/tenants/${tenantId}/meta`).then(print).catch(handleError);
