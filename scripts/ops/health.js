/**
 * ops/health.js — Check control-plane health
 * Usage: node scripts/ops/health.js
 */
const { get, print, handleError } = require("./_client");
get("/health").then(print).catch(handleError);
