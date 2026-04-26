/**
 * ops/call-show.js — full call_sessions doc for one call
 * Usage: node scripts/ops/call-show.js <call_control_id>
 */
const { get, print, handleError } = require("./_client");

const cci = process.argv[2];
if (!cci) { console.error("Usage: node scripts/ops/call-show.js <call_control_id>"); process.exit(1); }
get(`/calls/${encodeURIComponent(cci)}`).then(print).catch(handleError);
