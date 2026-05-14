const { log, logError } = require("./log");

const ELKS_API_BASE = "https://api.46elks.com/a1";
const DIAL_TIMEOUT_MS = 8000;

function getAuth() {
  const user = process.env.ELK_API_USER?.trim();
  const pass = process.env.ELK_API_PASS?.trim();
  if (!user || !pass) throw new Error("ELK_API_USER or ELK_API_PASS is not set");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

/**
 * Initiate an outbound call via 46elks.
 * voiceStartUrl must be a wss:// URL — 46elks opens a WebSocket directly to the bridge
 * when the recipient answers, bypassing any HTTP webhook indirection.
 *
 * @param {{ from: string, to: string, voiceStartUrl: string, traceId: string }} opts
 * @returns {Promise<{ ok: boolean, callid?: string, error?: string }>}
 */
async function dialElksOutbound({ from, to, voiceStartUrl, traceId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIAL_TIMEOUT_MS);
  const t0 = Date.now();

  const body = new URLSearchParams({
    from,
    to,
    voice_start: voiceStartUrl,
    timeout: "30",
  });

  try {
    const res = await fetch(`${ELKS_API_BASE}/calls`, {
      method: "POST",
      headers: {
        "Authorization": getAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const elapsed = Date.now() - t0;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logError("elks_dial_failed", { trace_id: traceId, status: res.status, elapsed_ms: elapsed, response: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }

    let json;
    try { json = JSON.parse(text); } catch { json = {}; }
    log("elks_dial_sent", { trace_id: traceId, status: res.status, elapsed_ms: elapsed, callid: json.id });
    return { ok: true, callid: json.id };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err.name === "AbortError") {
      logError("elks_dial_timeout", { trace_id: traceId, elapsed_ms: elapsed });
      return { ok: false, error: "timeout" };
    }
    logError("elks_dial_error", { trace_id: traceId, error: err.message, elapsed_ms: elapsed });
    return { ok: false, error: err.message };
  }
}

module.exports = { dialElksOutbound };
