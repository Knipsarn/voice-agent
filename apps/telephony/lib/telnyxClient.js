const { log, logError } = require("./log");

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const ANSWER_TIMEOUT_MS = 8000;

function getApiKey() {
  const key = process.env.TELNYX_API_KEY?.trim();
  if (!key) throw new Error("TELNYX_API_KEY is not set");
  return key;
}

// Answer an inbound call AND start bidirectional media streaming in one command.
// Telnyx will open a WebSocket to stream_url and exchange G.711 ulaw frames with the bridge.
async function answerWithStream({ callControlId, streamUrl, traceId }) {
  const url = `${TELNYX_API_BASE}/calls/${encodeURIComponent(callControlId)}/actions/answer`;
  const body = {
    stream_url: streamUrl,
    stream_track: "inbound_track",
    stream_codec: "PCMU",
    stream_bidirectional_mode: "rtp",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError("telnyx_answer_failed", {
        trace_id: traceId,
        status: res.status,
        elapsed_ms: elapsed,
        response: text.slice(0, 500),
      });
      return { ok: false, status: res.status };
    }

    log("telnyx_answer_sent", { trace_id: traceId, status: res.status, elapsed_ms: elapsed });
    return { ok: true, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err.name === "AbortError") {
      logError("telnyx_answer_timeout", { trace_id: traceId, elapsed_ms: elapsed });
      return { ok: false, error: "timeout" };
    }
    logError("telnyx_answer_error", { trace_id: traceId, error: err.message, elapsed_ms: elapsed });
    return { ok: false, error: err.message };
  }
}

// Initiate an OUTBOUND call. Telnyx dials `to` from `from`, and once the
// recipient answers, automatically starts bidirectional media streaming
// to streamUrl. The bridge handles first-message playback when it sees
// the answered call.
async function dialOutbound({ from, to, streamUrl, connectionId, clientState, traceId }) {
  const url = `${TELNYX_API_BASE}/calls`;
  const body = {
    to,
    from,
    connection_id: connectionId,
    stream_url: streamUrl,
    stream_track: "inbound_track",  // ONLY the lead's voice — not our own outbound echo
    stream_codec: "PCMU",
    stream_bidirectional_mode: "rtp",
    timeout_secs: 30,        // ring for up to 30s before giving up
    answering_machine_detection: "premium",  // skip voicemail boxes
  };
  if (clientState) body.client_state = Buffer.from(clientState, "utf8").toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const elapsed = Date.now() - t0;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logError("telnyx_dial_failed", { trace_id: traceId, status: res.status, elapsed_ms: elapsed, response: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = JSON.parse(text);
    const callControlId = json?.data?.call_control_id;
    log("telnyx_dial_sent", { trace_id: traceId, status: res.status, elapsed_ms: elapsed, call_control_id: callControlId });
    return { ok: true, status: res.status, call_control_id: callControlId };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err.name === "AbortError") {
      logError("telnyx_dial_timeout", { trace_id: traceId, elapsed_ms: elapsed });
      return { ok: false, error: "timeout" };
    }
    logError("telnyx_dial_error", { trace_id: traceId, error: err.message, elapsed_ms: elapsed });
    return { ok: false, error: err.message };
  }
}

module.exports = { answerWithStream, dialOutbound };
