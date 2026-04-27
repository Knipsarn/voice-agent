/**
 * lib/pricing.js
 *
 * Customer-facing pricing math. Per business decisions: 3 SEK / minute
 * + 1000 kr static monthly (allocated separately by billing rollup,
 * not on per-call lines).
 */

const PER_MINUTE_SEK = parseFloat(process.env.PRICE_PER_MINUTE_SEK || "3");

export function priceForCall(durationMs = 0) {
  const minutes = (durationMs || 0) / 60000;
  return +(minutes * PER_MINUTE_SEK).toFixed(2);
}

export function marginForCall(durationMs = 0, costTotalSek = 0) {
  const price = priceForCall(durationMs);
  return +(price - (costTotalSek || 0)).toFixed(4);
}

export const RATES = { per_minute_sek: PER_MINUTE_SEK };
