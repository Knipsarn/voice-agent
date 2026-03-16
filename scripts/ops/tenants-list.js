/**
 * ops/tenants-list.js — List all known tenants
 * Usage: node scripts/ops/tenants-list.js
 */
const { get, print } = require("./_client");
get("/tenants").then(print).catch(err => { console.error(err.message); process.exit(1); });
