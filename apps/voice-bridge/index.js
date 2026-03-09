// Load local env file for development.
// In Cloud Run the file won't exist; dotenv silently does nothing.
// Existing env vars (set by Cloud Run) are never overwritten.
require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");

const { loadTenant, buildInstructions } = require("./tenantLoader");

// ─── Startup constants ────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || null;
const DEFAULT_REALTIME_MODEL = process.env.DEFAULT_REALTIME_MODEL || "gpt-realtime-1.5";
const DEFAULT_VOICE = "alloy";
const FALLBACK_INSTRUCTIONS = "You are a helpful phone assistant.";

// ─── Startup validation ───────────────────────────────────────────────────────

if (!OPENAI_API_KEY) {
  console.error("[startup] FATAL: OPENAI_API_KEY is not set. Exiting.");
  process.exit(1);
}

if (!DEFAULT_TENANT_ID) {
  console.warn("[startup] WARNING: DEFAULT_TENANT_ID not set — calls without ?tenant= will use hardcoded fallback.");
}

const tenantConfigDir =
  process.env.TENANT_CONFIG_DIR || path.join(__dirname, "../../config/tenants");

if (!fs.existsSync(tenantConfigDir)) {
  console.warn(`[startup] WARNING: Tenant config directory not found: ${tenantConfigDir}`);
} else {
  console.log(`[startup] Tenant config dir OK: ${tenantConfigDir}`);
}

console.log(`[startup] Default model: ${DEFAULT_REALTIME_MODEL} | Default tenant: ${DEFAULT_TENANT_ID || "(none)"}`);

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("voice bridge alive");
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Per-connection handler ───────────────────────────────────────────────────

wss.on("connection", (telnyxWs, req) => {
  // --- Tenant resolution ---
  const query = url.parse(req.url, true).query;
  const tenantId = query.tenant || DEFAULT_TENANT_ID;

  const tenantConfig = tenantId ? loadTenant(tenantId) : null;
  const usingFallback = !tenantConfig;

  const instructions = usingFallback
    ? FALLBACK_INSTRUCTIONS
    : buildInstructions(tenantConfig);

  const voice = tenantConfig?.voice || DEFAULT_VOICE;
  const realtimeModel = tenantConfig?.realtime_model || DEFAULT_REALTIME_MODEL;
  const entryMode = tenantConfig?.entry_mode || "unknown";

  // First-message: enabled only when tenant config is loaded and field is set
  const firstMessage = !usingFallback && tenantConfig.first_message_enabled
    ? (tenantConfig.first_message || null)
    : null;

  console.log(
    `[bridge] connection — tenant: ${tenantId || "(none)"} | model: ${realtimeModel} | voice: ${voice} | entry_mode: ${entryMode} | first_message: ${!!firstMessage} | fallback: ${usingFallback}`
  );

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
    console.log(`[bridge] OpenAI ready — tenant: ${tenantId || "(none)"}`);
    openaiReady = true;

    // Audio codec path: g711_ulaw in and out — do not change
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions,
        voice,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw"
      }
    }));

    // Trigger first_message using a per-response instruction override.
    // This is more reliable than embedding a cue in session instructions:
    // the response-level instruction targets only this one response and
    // does not pollute the session persona for the rest of the conversation.
    if (firstMessage) {
      console.log(`[bridge] first_message triggered — tenant: ${tenantId}`);
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

      if (msg.event === "media" && msg.media && msg.media.payload) {
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: msg.media.payload
        }));
      }

      if (msg.event === "stop") {
        openaiWs.close();
      }
    } catch (err) {
      console.error(`[bridge] Telnyx parse error — tenant: ${tenantId || "(none)"}:`, err.message);
    }
  });

  // --- OpenAI -> Telnyx ---
  openaiWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "response.audio.delta" && msg.delta) {
        telnyxWs.send(JSON.stringify({
          event: "media",
          media: { payload: msg.delta }
        }));
      }
    } catch (err) {
      console.error(`[bridge] OpenAI parse error — tenant: ${tenantId || "(none)"}:`, err.message);
    }
  });

  // --- Cleanup ---
  telnyxWs.on("close", () => {
    console.log(`[bridge] Telnyx disconnected — tenant: ${tenantId || "(none)"}`);
    try { openaiWs.close(); } catch (_) {}
  });

  openaiWs.on("close", () => {
    try { telnyxWs.close(); } catch (_) {}
  });

  telnyxWs.on("error", (err) =>
    console.error(`[bridge] Telnyx WS error — tenant: ${tenantId || "(none)"}:`, err.message)
  );
  openaiWs.on("error", (err) =>
    console.error(`[bridge] OpenAI WS error — tenant: ${tenantId || "(none)"}:`, err.message)
  );
});

// ─── Listen ───────────────────────────────────────────────────────────────────

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`[bridge] listening on ${port}`);
});
