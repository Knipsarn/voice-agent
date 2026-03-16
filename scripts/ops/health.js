/**
 * ops/health.js — Check control-plane health
 * Usage: node scripts/ops/health.js
 */
const { get, print } = require("./_client");
get("/health").then(print).catch(err => { console.error(err.message); process.exit(1); });
