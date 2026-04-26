/**
 * ops/call-reprocess.js — re-run the post-processor on a single call (force=true).
 * Usage: node scripts/ops/call-reprocess.js <call_control_id>
 *
 * Useful when tweaking the summarizer prompt and wanting to re-summarize past calls.
 */
const { post, print, handleError } = require("./_client");

const cci = process.argv[2];
if (!cci) { console.error("Usage: node scripts/ops/call-reprocess.js <call_control_id>"); process.exit(1); }
post(`/calls/${encodeURIComponent(cci)}/reprocess`).then(print).catch(handleError);
