/**
 * ops/number-show.js — Show one number's assignment record
 * Usage: node scripts/ops/number-show.js <e164>
 *   e.g. node scripts/ops/number-show.js +46105201311
 */
const { get, print, handleError } = require("./_client");

const e164 = process.argv[2];
if (!e164) {
  console.error("Usage: node scripts/ops/number-show.js <e164>");
  process.exit(1);
}
get(`/numbers/${encodeURIComponent(e164)}`).then(print).catch(handleError);
