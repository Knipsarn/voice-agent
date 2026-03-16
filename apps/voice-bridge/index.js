// Load local env file for development.
// In Cloud Run the file won't exist; dotenv silently does nothing.
// Existing env vars (set by Cloud Run) are never overwritten.
require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");
const crypto = require("crypto");

const { loadTenant, buildInstructions } = require("./tenantLoader");

// ─── Structured logging ───────────────────────────────────────────────────────
// Output JSON so Cloud Logging ingests as jsonPayload (queryable by field).
// Usage: log("call_start", { trace_id, tenant_id, ... })

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function logError(event, fields = {}) {
  console.error(JSON.stringify({ event, severity: "ERROR", ...fields }));
}

// ─── Startup constants ────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || null;
const DEFAULT_REALTIME_MODEL = process.env.DEFAULT_REALTIME_MODEL || "gpt-realtime-1.5";
const DEFAULT_VOICE = "alloy";
const FALLBACK_INSTRUCTIONS = "You are a helpful phone assistant.";

// ─── Startup validation ───────────────────────────────────────────────────────

if (!OPENAI_API_KEY) {
  console.error(JSON.stringify({ event: "startup_fatal", error: "OPENAI_API_KEY is not set" }));
  process.exit(1);
}

if (!DEFAULT_TENANT_ID) {
  console.warn(JSON.stringify({ event: "startup_warning", message: "DEFAULT_TENANT_ID not set — calls without ?tenant= will use hardcoded fallback" }));
}

log("startup", { model: DEFAULT_REALTIME_MODEL, default_tenant: DEFAULT_TENANT_ID || null });

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("voice bridge alive");
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Per-connection handler ───────────────────────────────────────────────────

wss.on("connection", async (telnyxWs, req) => {
  const trace_id = crypto.randomUUID();
  const callStart = Date.now();
  let openaiReadyTime = null;
  let firstAudioSent = false;
  let turnCountUser = 0;
  let turnCountAssistant = 0;

  // --- Tenant resolution ---
  const query = url.parse(req.url, true).query;
  const tenantId = query.tenant || DEFAULT_TENANT_ID;

  const tenantConfig = tenantId ? await loadTenant(tenantId) : null;
  const fallback = !tenantConfig;

  const instructions = fallback
    ? FALLBACK_INSTRUCTIONS
    : buildInstructions(tenantConfig);

  const voice = tenantConfig?.voice || DEFAULT_VOICE;
  const realtimeModel = tenantConfig?.realtime_model || DEFAULT_REALTIME_MODEL;
  const entryMode = tenantConfig?.entry_mode || "unknown";
  const firstMessage = !fallback && tenantConfig.first_message_enabled
    ? (tenantConfig.first_message || null)
    : null;
  const transcriptionLanguage = tenantConfig?.transcription_language || null;

  log("call_start", {
    trace_id,
    tenant_id: tenantId || null,
    model: realtimeModel,
    voice,
    entry_mode: entryMode,
    first_message: !!firstMessage,
    fallback,
    config_git_sha: tenantConfig?._meta?.git_sha || null,
    config_published_at: tenantConfig?._meta?.published_at || null,
    instructions_length: instructions.length,
  });

  // --- OpenAI Realtime session ---
  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${realtimeModel}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  let openaiReady = false;

  openaiWs.on("open", () => {
    openaiReady = true;
    openaiReadyTime = Date.now();

    log("openai_ready", {
      trace_id,
      tenant_id: tenantId || null,
      latency_ms: openaiReadyTime - callStart,
    });

    // Audio codec path: g711_ulaw in and out — do not change
    const sessionPayload = {
      instructions,
      voice,
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw"
    };

    // Always enable transcription so user speech is logged; language hint is optional.
    sessionPayload.input_audio_transcription = { model: "whisper-1" };
    if (transcriptionLanguage) {
      sessionPayload.input_audio_transcription.language = transcriptionLanguage;
    }

    openaiWs.send(JSON.stringify({ type: "session.update", session: sessionPayload }));

    // Trigger first_message using a per-response instruction override.
    if (firstMessage) {
      log("first_message", { trace_id, tenant_id: tenantId });
      openaiWs.send(JSON.stringify({
        type: "response.create",
        response: {
          instructions: `Say exactly: "${firstMessage}". Do not add any other words before or after.`
        }
      }));
    }
  });

  // --- Telnyx -> OpenAI ---
  telnyxWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!openaiReady) return;

      if (msg.event === "media" && msg.media?.payload) {
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: msg.media.payload
        }));
      }

      if (msg.event === "stop") {
        openaiWs.close();
      }
    } catch (err) {
      logError("telnyx_parse_error", { trace_id, tenant_id: tenantId || null, error: err.message });
    }
  });

  // --- OpenAI -> Telnyx ---
  openaiWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case "input_audio_buffer.speech_started":
          log("speech_started", { trace_id, tenant_id: tenantId || null, turn_user: turnCountUser + 1 });
          break;

        case "input_audio_buffer.speech_stopped":
          log("speech_stopped", { trace_id, tenant_id: tenantId || null });
          break;

        case "input_audio_buffer.committed":
          log("audio_committed", { trace_id, tenant_id: tenantId || null });
          break;

        case "conversation.item.created":
          if (msg.item?.role === "user") {
            turnCountUser++;
            log("user_turn", { trace_id, tenant_id: tenantId || null, turn_user: turnCountUser });
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          if (msg.transcript) {
            log("user_transcript", { trace_id, tenant_id: tenantId || null, turn_user: turnCountUser, text: msg.transcript });
          }
          break;

        case "response.audio_transcript.done":
          if (msg.transcript) {
            log("assistant_transcript", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant + 1, text: msg.transcript });
          }
          break;

        case "response.created":
          log("response_started", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant + 1 });
          break;

        case "response.audio.delta":
          if (msg.delta) {
            if (!firstAudioSent) {
              firstAudioSent = true;
              log("first_audio_token", {
                trace_id,
                tenant_id: tenantId || null,
                latency_ms: Date.now() - callStart,
              });
            }
            telnyxWs.send(JSON.stringify({
              event: "media",
              media: { payload: msg.delta }
            }));
          }
          break;

        case "response.done":
          turnCountAssistant++;
          log("response_done", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant });
          break;

        case "error":
          logError("openai_error", {
            trace_id,
            tenant_id: tenantId || null,
            error: msg.error?.message || JSON.stringify(msg.error),
          });
          break;
      }
    } catch (err) {
      logError("openai_parse_error", { trace_id, tenant_id: tenantId || null, error: err.message });
    }
  });

  // --- Cleanup ---
  telnyxWs.on("close", () => {
    log("call_end", {
      trace_id,
      tenant_id: tenantId || null,
      duration_ms: Date.now() - callStart,
      turn_count_user: turnCountUser,
      turn_count_assistant: turnCountAssistant,
    });
    try { openaiWs.close(); } catch (_) {}
  });

  openaiWs.on("close", () => {
    try { telnyxWs.close(); } catch (_) {}
  });

  telnyxWs.on("error", (err) =>
    logError("telnyx_ws_error", { trace_id, tenant_id: tenantId || null, error: err.message })
  );

  openaiWs.on("error", (err) =>
    logError("openai_ws_error", { trace_id, tenant_id: tenantId || null, error: err.message })
  );
});

// ─── Listen ───────────────────────────────────────────────────────────────────

const port = process.env.PORT || 8080;
server.listen(port, () => {
  log("startup_complete", { port });
});
