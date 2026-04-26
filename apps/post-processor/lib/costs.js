/**
 * lib/costs.js
 *
 * Per-call cost estimation (in SEK). These rates are PLACEHOLDERS — refine
 * once you have real invoice data per provider. They are deliberately
 * configurable via env vars so we can update without redeploying.
 *
 * NOTE: These are cost-of-goods-sold (COGS), the bill we owe providers per
 * call. The customer-facing PRICE (1000 kr/mo + per-minute fee) is a separate
 * concern handled by the billing module (future). Margin = price − cogs.
 *
 * Visible only in the admin dashboard, never the customer dashboard.
 */

// Telnyx voice — Sweden inbound, fixed-line, approx
const TELNYX_INBOUND_SEK_PER_MIN = parseFloat(process.env.COST_TELNYX_INBOUND_PER_MIN_SEK || "0.10");
// Telnyx voice — outbound minutes (used when we add outbound calling later)
const TELNYX_OUTBOUND_SEK_PER_MIN = parseFloat(process.env.COST_TELNYX_OUTBOUND_PER_MIN_SEK || "1.00");
// OpenAI Realtime — bidirectional audio, rough $0.04/min × 11 SEK/USD ≈ 0.44 SEK
const OPENAI_REALTIME_SEK_PER_MIN = parseFloat(process.env.COST_OPENAI_REALTIME_PER_MIN_SEK || "0.50");
// Summarizer (gpt-4o-mini default) — typical 3K in + 0.3K out per call, well under 0.01 SEK
const SUMMARIZER_FLAT_SEK = parseFloat(process.env.COST_SUMMARIZER_FLAT_SEK || "0.01");
// Cloud Run + Firestore + logging — negligible per call
const INFRA_FLAT_SEK = parseFloat(process.env.COST_INFRA_FLAT_SEK || "0.005");

function calculateCallCost({ direction = "inbound", durationMs = 0 }) {
  const minutes = (durationMs || 0) / 60000;
  const telnyxRate = direction === "outbound" ? TELNYX_OUTBOUND_SEK_PER_MIN : TELNYX_INBOUND_SEK_PER_MIN;

  const cost_telnyx_sek = +(minutes * telnyxRate).toFixed(4);
  const cost_openai_realtime_sek = +(minutes * OPENAI_REALTIME_SEK_PER_MIN).toFixed(4);
  const cost_summarizer_sek = +SUMMARIZER_FLAT_SEK.toFixed(4);
  const cost_infra_sek = +INFRA_FLAT_SEK.toFixed(4);
  const cost_total_sek = +(
    cost_telnyx_sek + cost_openai_realtime_sek + cost_summarizer_sek + cost_infra_sek
  ).toFixed(4);

  return {
    cost_telnyx_sek,
    cost_openai_realtime_sek,
    cost_summarizer_sek,
    cost_infra_sek,
    cost_total_sek,
    cost_minutes: +minutes.toFixed(3),
    cost_rates_used: {
      telnyx_per_min_sek: telnyxRate,
      openai_realtime_per_min_sek: OPENAI_REALTIME_SEK_PER_MIN,
      summarizer_flat_sek: SUMMARIZER_FLAT_SEK,
      infra_flat_sek: INFRA_FLAT_SEK,
    },
  };
}

module.exports = { calculateCallCost };
