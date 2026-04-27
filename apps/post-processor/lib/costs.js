/**
 * lib/costs.js
 *
 * Per-call cost calculation in SEK. Two modes:
 *
 * 1. EXACT — when the bridge captured `realtime_usage` (token counts from
 *    OpenAI Realtime response.done events). Cost = sum of token-class rates.
 *    Telnyx is per-minute by region (rate is stable, published).
 *
 * 2. ESTIMATE — fallback for calls without usage data (e.g. very short calls
 *    or older docs). Per-minute estimates for both providers.
 *
 * All rates are env-overridable. Defaults are tuned for gpt-realtime-1.5
 * pricing and Telnyx Sweden DID inbound as of late 2025.
 */

// USD → SEK FX rate (override if needed; updates won't affect historical
// rows since costs are persisted on the call_sessions doc).
const USD_TO_SEK = parseFloat(process.env.COST_USD_TO_SEK || "10.5");

// OpenAI Realtime per-1M-token rates in USD (gpt-realtime / gpt-realtime-1.5)
const OPENAI = {
  text_input:        parseFloat(process.env.COST_OPENAI_TEXT_INPUT_USD_PER_1M  || "4.00"),
  text_output:       parseFloat(process.env.COST_OPENAI_TEXT_OUTPUT_USD_PER_1M || "16.00"),
  audio_input:       parseFloat(process.env.COST_OPENAI_AUDIO_INPUT_USD_PER_1M || "32.00"),
  audio_output:      parseFloat(process.env.COST_OPENAI_AUDIO_OUTPUT_USD_PER_1M|| "64.00"),
  cached_text_input: parseFloat(process.env.COST_OPENAI_CACHED_TEXT_INPUT_USD_PER_1M  || "0.40"),
  cached_audio_input:parseFloat(process.env.COST_OPENAI_CACHED_AUDIO_INPUT_USD_PER_1M || "0.40"),
};

// Telnyx voice — Sweden DID inbound, USD per minute. Stable published rate.
// For outbound (Phase D) we'll add per-destination rates.
const TELNYX = {
  inbound_se_usd_per_min:  parseFloat(process.env.COST_TELNYX_INBOUND_SE_USD_PER_MIN  || "0.0085"),
  outbound_se_landline_usd_per_min: parseFloat(process.env.COST_TELNYX_OUTBOUND_SE_LANDLINE_USD_PER_MIN || "0.025"),
  outbound_se_mobile_usd_per_min:   parseFloat(process.env.COST_TELNYX_OUTBOUND_SE_MOBILE_USD_PER_MIN   || "0.10"),
};

// Summarizer — gpt-4o-mini, ~3K input + 0.3K output per call. Negligible.
const SUMMARIZER_FLAT_SEK = parseFloat(process.env.COST_SUMMARIZER_FLAT_SEK || "0.005");
// Cloud Run + Firestore + logging per call.
const INFRA_FLAT_SEK = parseFloat(process.env.COST_INFRA_FLAT_SEK || "0.005");

function round4(n) { return +Number(n).toFixed(4); }
function usdToSek(usd) { return usd * USD_TO_SEK; }

function openaiCostFromUsage(usage) {
  if (!usage) return null;
  // Cached tokens are billed at the cached rate; "regular" input is the
  // remainder. usage.input_*_tokens already includes cached counts, so we
  // subtract cached to avoid double-billing.
  const inputTextRegular  = Math.max(0, (usage.input_text_tokens  || 0) - (usage.input_cached_text_tokens  || 0));
  const inputAudioRegular = Math.max(0, (usage.input_audio_tokens || 0) - (usage.input_cached_audio_tokens || 0));

  const cost_usd =
      (inputTextRegular  / 1e6) * OPENAI.text_input
    + (inputAudioRegular / 1e6) * OPENAI.audio_input
    + ((usage.input_cached_text_tokens  || 0) / 1e6) * OPENAI.cached_text_input
    + ((usage.input_cached_audio_tokens || 0) / 1e6) * OPENAI.cached_audio_input
    + ((usage.output_text_tokens  || 0) / 1e6) * OPENAI.text_output
    + ((usage.output_audio_tokens || 0) / 1e6) * OPENAI.audio_output;

  return {
    cost_sek:  round4(usdToSek(cost_usd)),
    cost_usd:  round4(cost_usd),
    breakdown: {
      input_text_regular_tokens:  inputTextRegular,
      input_audio_regular_tokens: inputAudioRegular,
      input_cached_text_tokens:   usage.input_cached_text_tokens || 0,
      input_cached_audio_tokens:  usage.input_cached_audio_tokens || 0,
      output_text_tokens:         usage.output_text_tokens || 0,
      output_audio_tokens:        usage.output_audio_tokens || 0,
      total_tokens:               usage.total_tokens || 0,
      responses:                  usage.responses || 0,
    },
  };
}

function telnyxCost({ direction = "inbound", destinationType = "landline", durationMs = 0 }) {
  const minutes = (durationMs || 0) / 60000;
  let usdPerMin;
  if (direction === "outbound") {
    usdPerMin = destinationType === "mobile"
      ? TELNYX.outbound_se_mobile_usd_per_min
      : TELNYX.outbound_se_landline_usd_per_min;
  } else {
    usdPerMin = TELNYX.inbound_se_usd_per_min;
  }
  const usd = minutes * usdPerMin;
  return { cost_sek: round4(usdToSek(usd)), cost_usd: round4(usd), per_min_usd: usdPerMin };
}

function calculateCallCost({ direction = "inbound", destinationType = "landline", durationMs = 0, realtimeUsage = null } = {}) {
  const telnyx = telnyxCost({ direction, destinationType, durationMs });
  const openaiExact = openaiCostFromUsage(realtimeUsage);

  // Fallback path: no usage data → per-minute estimate (cheap-rate placeholder)
  let cost_openai_realtime_sek;
  let openai_method;
  let openai_breakdown = null;
  if (openaiExact) {
    cost_openai_realtime_sek = openaiExact.cost_sek;
    openai_method = "exact_from_tokens";
    openai_breakdown = openaiExact.breakdown;
  } else {
    const minutes = (durationMs || 0) / 60000;
    const fallbackPerMin = parseFloat(process.env.COST_OPENAI_REALTIME_FALLBACK_SEK_PER_MIN || "0.50");
    cost_openai_realtime_sek = round4(minutes * fallbackPerMin);
    openai_method = "estimate_per_minute";
  }

  const cost_telnyx_sek = telnyx.cost_sek;
  const cost_summarizer_sek = round4(SUMMARIZER_FLAT_SEK);
  const cost_infra_sek = round4(INFRA_FLAT_SEK);
  const cost_total_sek = round4(cost_telnyx_sek + cost_openai_realtime_sek + cost_summarizer_sek + cost_infra_sek);

  return {
    cost_telnyx_sek,
    cost_openai_realtime_sek,
    cost_summarizer_sek,
    cost_infra_sek,
    cost_total_sek,
    cost_minutes: round4((durationMs || 0) / 60000),
    cost_method: openai_method,
    cost_rates_used: {
      usd_to_sek: USD_TO_SEK,
      telnyx_per_min_usd: telnyx.per_min_usd,
      openai_text_input_usd_per_1m: OPENAI.text_input,
      openai_text_output_usd_per_1m: OPENAI.text_output,
      openai_audio_input_usd_per_1m: OPENAI.audio_input,
      openai_audio_output_usd_per_1m: OPENAI.audio_output,
      openai_cached_input_usd_per_1m: OPENAI.cached_audio_input,
    },
    cost_openai_breakdown: openai_breakdown,
  };
}

module.exports = { calculateCallCost };
