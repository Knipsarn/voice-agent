/**
 * ops/tenants-list.js — List all known tenants
 * Usage: node scripts/ops/tenants-list.js
 */
const { get, print, handleError } = require("./_client");
get("/tenants").then(print).catch(handleError);
