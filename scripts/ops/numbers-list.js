/**
 * ops/numbers-list.js — List all assigned phone numbers
 * Usage: node scripts/ops/numbers-list.js
 */
const { get, print, handleError } = require("./_client");
get("/numbers").then(print).catch(handleError);
