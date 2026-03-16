/**
 * ops/tenant-get.js — Get full Firestore document for a tenant
 * Usage: node scripts/ops/tenant-get.js <tenantId>
 */
const { get, print, handleError } = require("./_client");

const tenantId = process.argv[2];
if (!tenantId) { console.error("Usage: node scripts/ops/tenant-get.js <tenantId>"); process.exit(1); }

get(`/tenants/${tenantId}`).then(print).catch(handleError);
