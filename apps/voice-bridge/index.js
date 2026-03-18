// Load local env file for development.
// In Cloud Run the file won't exist; dotenv silently does nothing.
// Existing env vars (set by Cloud Run) are never overwritten.
require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");
const crypto = require("crypto");

const { loadTenant, buildInstructions, buildWorkflowInstructions, generateWorkflowTools, isWorkflowEnabled } = require("./tenantLoader");

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
const TELNYX_API_KEY = process.env.TELNYX_API_KEY?.trim() || null;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || null;
const DEFAULT_REALTIME_MODEL = process.env.DEFAULT_REALTIME_MODEL || "gpt-realtime-1.5";
const DEFAULT_VOICE = "alloy";
const FALLBACK_INSTRUCTIONS = "You are a helpful phone assistant.";
const END_CALL_ADDENDUM = "\n\n# Samtalsavslut\nDu har tillgång till funktionen end_call som lägger på luren. Du MÅSTE anropa end_call när: samtalet är klart, uppringaren säger hejdå eller ber dig lägga på, eller ärendet är avslutat och bekräftat. Säg alltid ett kort avsked INNAN du anropar end_call. Säg aldrig hejdå utan att faktiskt anropa end_call — annars hänger samtalet kvar.";

const END_CALL_TOOL = {
  type: "function",
  name: "end_call",
  description: "Physically disconnects the phone call. You MUST call this tool when: (1) the caller says goodbye or asks to hang up, (2) the intake is complete and confirmed, (3) the caller has no further questions. Always say a farewell phrase to the caller BEFORE invoking this tool. Never just say goodbye verbally — you MUST call end_call to actually hang up.",
  parameters: { type: "object", properties: {}, required: [] }
};

// Classify workflow mode type for conditional tool/instruction/modality setup.
// "routing" = silent router (text-only, tool_choice required, no end_call).
// "phone_transfer" = speaks one line then Telnyx transfers the call.
// "leaf" = interactive mode that speaks to caller, collects data, may escalate.
function getModeType(modeConfig) {
  if (!modeConfig) return "leaf";
  if (modeConfig.phone_transfer) return "phone_transfer";
  if (modeConfig.router) return "routing";
  return "leaf";
}

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
  const transcripts = [];

  // --- Tenant resolution ---
  const query = url.parse(req.url, true).query;
  const tenantId = query.tenant || DEFAULT_TENANT_ID;
  // URL query parsing decodes "+" as space — restore leading "+" for E.164 numbers
  const callerNumber = query.caller ? query.caller.trim().replace(/^(\d)/, "+$1") : null;
  const sessionId = query["session-id"] || null;
  const callControlId = query["call_control_id"] || query["control-id"] || null;

  const tenantConfig = tenantId ? await loadTenant(tenantId) : null;
  const fallback = !tenantConfig;
  const workflowEnabled = !fallback && isWorkflowEnabled(tenantConfig);

  // --- Workflow state (per-connection) ---
  let currentMode = workflowEnabled ? tenantConfig.workflow.initial_mode : null;
  const visitedModes = workflowEnabled ? new Set([currentMode]) : null;
  let pendingPhoneTransfer = null; // set when mode has phone_transfer; fires after new mode's response.done
  let pendingHangup = false;       // set when end_call tool fires; executes after response.done + delay
  let awaitingTransferResponse = false; // true = next response.done is the OLD mode's; skip it
  let transferFired = false;       // true = phone transfer initiated; stop all audio forwarding

  // Determine initial mode type for conditional tool/instruction setup
  const initialModeType = workflowEnabled
    ? getModeType(tenantConfig.workflow.modes?.[currentMode])
    : "leaf";

  // Compute current time context for the agent (used for phone hours routing)
  let timeContext = "";
  if (tenantConfig?.phone_hours) {
    const tz = tenantConfig.phone_hours.timezone || "Europe/Stockholm";
    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const dayNames = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
    const hh = local.getHours().toString().padStart(2, "0");
    const mm = local.getMinutes().toString().padStart(2, "0");
    timeContext = `Aktuell tid: ${dayNames[local.getDay()]} ${hh}:${mm}\n\n`;
  }

  // Build initial instructions
  let instructions;
  if (fallback) {
    instructions = FALLBACK_INSTRUCTIONS;
  } else if (workflowEnabled) {
    instructions = timeContext + buildWorkflowInstructions(tenantConfig, currentMode);
  } else {
    instructions = buildInstructions(tenantConfig);
  }
  // Only append end_call instructions for leaf modes (not routing or phone_transfer)
  if (initialModeType === "leaf") {
    instructions += END_CALL_ADDENDUM;
  }

  const voice = tenantConfig?.voice || DEFAULT_VOICE;
  const realtimeModel = tenantConfig?.realtime_model || DEFAULT_REALTIME_MODEL;
  const entryMode = tenantConfig?.entry_mode || "unknown";
  const firstMessage = !fallback && tenantConfig.first_message_enabled
    ? (tenantConfig.first_message || null)
    : null;
  const firstMessageDelayMs = tenantConfig?.first_message_delay_ms || 0;
  const transcriptionLanguage = tenantConfig?.transcription_language || null;
  let audioForwardingReady = (firstMessageDelayMs === 0); // hold off during welcome audio

  log("call_start", {
    trace_id,
    tenant_id: tenantId || null,
    session_id: sessionId,
    caller_number: callerNumber,
    call_control_id: callControlId,
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

    // Build tool set: end_call only for leaf modes, transfer tools for workflow modes
    if (workflowEnabled) {
      const transferTools = generateWorkflowTools(tenantConfig, currentMode);
      sessionPayload.tools = initialModeType === "leaf"
        ? [END_CALL_TOOL, ...transferTools]
        : transferTools;
    } else {
      sessionPayload.tools = [END_CALL_TOOL];
    }
    sessionPayload.tool_choice = "auto";

    openaiWs.send(JSON.stringify({ type: "session.update", session: sessionPayload }));

    // Trigger first_message — delay if a pre-recorded welcome audio plays first.
    // During the delay, audio forwarding from Telnyx is suppressed so the welcome
    // audio doesn't bleed into OpenAI and get interpreted as caller speech.
    const sendFirstMessage = () => {
      audioForwardingReady = true;
      if (firstMessage) {
        log("first_message", { trace_id, tenant_id: tenantId, delay_ms: firstMessageDelayMs });
        openaiWs.send(JSON.stringify({
          type: "response.create",
          response: {
            instructions: `Say exactly: "${firstMessage}". Do not add any other words before or after.`
          }
        }));
      }
    };

    if (firstMessageDelayMs > 0) {
      setTimeout(sendFirstMessage, firstMessageDelayMs);
    } else {
      sendFirstMessage();
    }
  });

  // --- Telnyx -> OpenAI ---
  telnyxWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!openaiReady || transferFired || !audioForwardingReady) return;

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
            transcripts.push({ role: "user", message: msg.transcript, time_in_call_secs: Math.round((Date.now() - callStart) / 1000) });
          }
          break;

        case "response.audio_transcript.done":
          if (msg.transcript) {
            log("assistant_transcript", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant + 1, text: msg.transcript });
            transcripts.push({ role: "agent", message: msg.transcript, time_in_call_secs: Math.round((Date.now() - callStart) / 1000) });
          }
          break;

        case "response.created":
          log("response_started", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant + 1 });
          break;

        case "response.audio.delta":
          if (msg.delta && !transferFired) {
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

        case "response.output_item.done":
          // Handle function tool calls at the canonical event (fires before response.done)
          if (msg.item?.type === "function_call" && msg.item?.status === "completed") {
            const fnName = msg.item.name;

            if (fnName === "end_call") {
              log("end_call_tool", { trace_id, tenant_id: tenantId || null, call_id: msg.item.call_id });
              openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: msg.item.call_id,
                  output: JSON.stringify({ success: true })
                }
              }));
              // Don't hang up immediately — audio may still be streaming through the phone.
              // Set flag; response.done will fire hangup after a short buffer delay.
              pendingHangup = true;

            } else if (workflowEnabled && fnName.startsWith("transfer_to_")) {
              const targetMode = fnName.replace("transfer_to_", "");
              const modeExists = !!tenantConfig.workflow.modes?.[targetMode];

              if (!modeExists) {
                logError("mode_switch_invalid", { trace_id, tenant_id: tenantId || null, from: currentMode, to: targetMode });
                openaiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: { type: "function_call_output", call_id: msg.item.call_id, output: JSON.stringify({ error: "unknown mode" }) }
                }));
                openaiWs.send(JSON.stringify({ type: "response.create" }));
                break;
              }

              if (visitedModes.has(targetMode)) {
                log("mode_switch_revisit", { trace_id, tenant_id: tenantId || null, from: currentMode, to: targetMode });
              }

              const previousMode = currentMode;
              currentMode = targetMode;
              visitedModes.add(targetMode);

              const targetModeConfig = tenantConfig.workflow.modes[targetMode];
              const modeType = getModeType(targetModeConfig);

              // Build instructions — prepend time context, append END_CALL_ADDENDUM for leaf modes
              const newInstructions = timeContext
                + buildWorkflowInstructions(tenantConfig, targetMode)
                + (modeType === "leaf" ? END_CALL_ADDENDUM : "");

              // Build tools — only include end_call for leaf modes
              const transferTools = generateWorkflowTools(tenantConfig, targetMode);
              const tools = modeType === "leaf"
                ? [END_CALL_TOOL, ...transferTools]
                : transferTools;

              // Single merged session.update — all fields in one message
              // Routing modes: text-only + tool_choice required (silent, immediate function call)
              // Phone transfer & leaf modes: text+audio + tool_choice auto
              const sessionUpdate = {
                instructions: newInstructions,
                tools,
                tool_choice: modeType === "routing" ? "required" : "auto",
                modalities: modeType === "routing" ? ["text"] : ["text", "audio"],
              };
              if (modeType !== "routing") {
                sessionUpdate.output_audio_format = "g711_ulaw";
              }
              openaiWs.send(JSON.stringify({ type: "session.update", session: sessionUpdate }));

              // ACK the function call
              openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: msg.item.call_id,
                  output: JSON.stringify({ transferred: true, new_mode: targetMode })
                }
              }));

              // Trigger response — no instruction override; full session instructions drive the model
              openaiWs.send(JSON.stringify({ type: "response.create" }));

              if (targetModeConfig?.phone_transfer) {
                pendingPhoneTransfer = targetModeConfig.phone_transfer;
                awaitingTransferResponse = true; // skip the next response.done (old mode's)
              }

              log("mode_switch", {
                trace_id,
                tenant_id: tenantId || null,
                from: previousMode,
                to: targetMode,
                mode_type: modeType,
                instructions_length: newInstructions.length,
                tools_count: tools.length,
                phone_transfer: targetModeConfig?.phone_transfer || null,
              });
            }
          }
          break;

        case "response.done":
          turnCountAssistant++;
          log("response_done", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant });
          // Fire phone transfer after agent finishes speaking in the NEW mode.
          // awaitingTransferResponse = true means this response.done is for the OLD mode — skip.
          if (pendingPhoneTransfer) {
            if (awaitingTransferResponse) {
              awaitingTransferResponse = false;
            } else {
              const transferTo = pendingPhoneTransfer;
              pendingPhoneTransfer = null;
              transferFired = true; // stop audio forwarding immediately
              log("transfer_firing", { trace_id, tenant_id: tenantId || null, to: transferTo });
              // Delay transfer so agent's audio finishes playing through the phone line
              // before the caller hears the transfer ringing tone.
              setTimeout(() => {
                fireTransfer(transferTo);
                // Agent is done — close OpenAI to stop further responses/token usage
                try { openaiWs.close(); } catch (_) {}
              }, 2000);
            }
          }
          // Fire hangup after a short delay so audio finishes playing through the phone line
          if (pendingHangup) {
            pendingHangup = false;
            setTimeout(fireHangup, 2500);
          }
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

  // --- Telnyx hangup ---
  function fireHangup() {
    log("hangup_attempt", { trace_id, tenant_id: tenantId || null, has_ccid: !!callControlId, has_key: !!TELNYX_API_KEY });
    if (!callControlId || !TELNYX_API_KEY) {
      logError("hangup_skipped", { trace_id, tenant_id: tenantId || null, reason: !callControlId ? "no call_control_id" : "no TELNYX_API_KEY" });
      return;
    }
    // URL-encode the call_control_id — it may contain ":" which confuses URL parsers
    const hangupUrl = new URL(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`);
    const reqData = JSON.stringify({});
    const telnyxReq = require("https").request(hangupUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(reqData)
      },
      timeout: 8000
    }, (res) => {
      log("hangup_sent", { trace_id, tenant_id: tenantId || null, status: res.statusCode });
      res.resume();
    });
    telnyxReq.on("timeout", () => {
      logError("hangup_timeout", { trace_id, tenant_id: tenantId || null });
      telnyxReq.destroy();
    });
    telnyxReq.on("error", (err) => {
      logError("hangup_error", { trace_id, tenant_id: tenantId || null, error: err.message });
    });
    telnyxReq.write(reqData);
    telnyxReq.end();
  }

  // --- Telnyx phone transfer ---
  function fireTransfer(toNumber) {
    log("transfer_attempt", { trace_id, tenant_id: tenantId || null, to: toNumber, has_ccid: !!callControlId, has_key: !!TELNYX_API_KEY });
    if (!callControlId || !TELNYX_API_KEY) {
      logError("transfer_skipped", { trace_id, tenant_id: tenantId || null, reason: !callControlId ? "no call_control_id" : "no TELNYX_API_KEY" });
      return;
    }
    const transferUrl = new URL(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/transfer`);
    const reqData = JSON.stringify({ to: toNumber });
    const telnyxReq = require("https").request(transferUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(reqData)
      },
      timeout: 8000
    }, (res) => {
      log("transfer_sent", { trace_id, tenant_id: tenantId || null, status: res.statusCode, to: toNumber });
      res.resume();
    });
    telnyxReq.on("timeout", () => {
      logError("transfer_timeout", { trace_id, tenant_id: tenantId || null, to: toNumber });
      telnyxReq.destroy();
    });
    telnyxReq.on("error", (err) => {
      logError("transfer_error", { trace_id, tenant_id: tenantId || null, to: toNumber, error: err.message });
    });
    telnyxReq.write(reqData);
    telnyxReq.end();
  }

  // --- Cleanup ---
  // endCall() is guarded against double-invocation — fires from whichever WS closes first.
  let callEnded = false;
  function endCall() {
    if (callEnded) return;
    callEnded = true;

    const durationMs = Date.now() - callStart;
    log("call_end", {
      trace_id,
      tenant_id: tenantId || null,
      duration_ms: durationMs,
      turn_count_user: turnCountUser,
      turn_count_assistant: turnCountAssistant,
      transfer_fired: transferFired,
    });

    try { openaiWs.close(); } catch (_) {}
    // Don't close Telnyx WS if a phone transfer is active — Telnyx manages the connection
    if (!transferFired) {
      try { telnyxWs.close(); } catch (_) {}
    }

    // --- Post-call webhook ---
    const webhookUrl = tenantConfig?.webhook?.post_call_url;
    if (webhookUrl && tenantConfig?.webhook?.enabled !== false) {
      const payload = {
        type: "post_call_transcription",
        event_timestamp: Math.floor(Date.now() / 1000),
        data: {
          tenant_id: tenantId,
          trace_id,
          caller_number: callerNumber,
          session_id: sessionId,
          status: "done",
          metadata: {
            start_time_unix_secs: Math.floor(callStart / 1000),
            call_duration_secs: Math.round(durationMs / 1000),
            turn_count_user: turnCountUser,
            turn_count_assistant: turnCountAssistant,
            voice,
            model: realtimeModel,
            entry_mode: entryMode,
            config_git_sha: tenantConfig?._meta?.git_sha || null,
          },
          transcript: transcripts,
        },
      };

      try {
        const webhookUrlObj = new URL(webhookUrl);
        const lib = webhookUrlObj.protocol === "https:" ? require("https") : require("http");
        const reqData = JSON.stringify(payload);
        const webhookReq = lib.request(webhookUrlObj, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(reqData) },
        }, (res) => {
          log("webhook_sent", { trace_id, tenant_id: tenantId, status: res.statusCode });
          res.resume();
        });
        webhookReq.on("error", (err) => {
          logError("webhook_error", { trace_id, tenant_id: tenantId, error: err.message });
        });
        webhookReq.write(reqData);
        webhookReq.end();
      } catch (err) {
        logError("webhook_error", { trace_id, tenant_id: tenantId, error: err.message });
      }
    }
  }

  telnyxWs.on("close", endCall);
  openaiWs.on("close", endCall);

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
