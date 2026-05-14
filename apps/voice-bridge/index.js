// Load local env file for development.
// In Cloud Run the file won't exist; dotenv silently does nothing.
// Existing env vars (set by Cloud Run) are never overwritten.
require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");
const crypto = require("crypto");

const { loadTenant, buildInstructions, buildWorkflowInstructions, generateWorkflowTools, isWorkflowEnabled, fetchPriorCaseContext, scrapeLeadWebsite, buildLeadContext } = require("./tenantLoader");
const { writeBridgeData: writeCallSessionBridgeData } = require("./lib/callSessions");

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

wss.on("connection", async (phoneWs, req) => {
  const trace_id = crypto.randomUUID();
  const callStart = Date.now();
  let openaiReadyTime = null;
  let firstAudioSent = false;
  let turnCountUser = 0;
  let turnCountAssistant = 0;
  const transcripts = [];

  // Barge-in tracking — used to truncate the assistant response when the user interrupts.
  let currentAssistantItemId = null; // set on response.audio.delta, cleared on response.done
  let assistantAudioMs = 0;          // cumulative ms of assistant audio sent this turn
  let elksNeedsSendingHeader = false; // true after an elks interrupt — must re-send { t: "sending" } before next audio

  // Observability: track audio activity around barge-in to diagnose blackouts + delayed cutoffs.
  let responseStartedAt = null;          // ms timestamp of latest response.created
  let lastBargeInAt = null;              // ms timestamp of latest interrupt
  let audioDeltasAfterBargeIn = 0;       // delta count post-interrupt (should be 0 if cancel works)
  let audioBytesAfterBargeIn = 0;        // raw base64 byte total post-interrupt
  let audioDeltasMissingSendHeader = 0;  // audio sent without prior {t:"sending"} (potential 46elks drop)

  // Phone-audio playback grace window: OpenAI's response.done fires when generation ends,
  // but the audio is still in-flight on the wire for 1-3s. During that window the user
  // perceives the agent as "still speaking" — so interrupts must still work.
  let phoneAudioActiveUntil = 0;         // ms timestamp; phone audio likely still playing until then
  let assistantAudioMsThisResponse = 0;  // audio duration emitted in the current response (for end_call guard)

  // OpenAI Realtime usage accumulator — summed across all response.done events
  // in this call. Used by the post-processor to compute exact cost per call
  // instead of the per-minute estimate.
  const realtimeUsage = {
    responses: 0,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    input_text_tokens: 0,
    input_audio_tokens: 0,
    input_cached_tokens: 0,
    input_cached_text_tokens: 0,
    input_cached_audio_tokens: 0,
    output_text_tokens: 0,
    output_audio_tokens: 0,
  };
  function addRealtimeUsage(usage) {
    if (!usage) return;
    realtimeUsage.responses += 1;
    realtimeUsage.total_tokens += usage.total_tokens || 0;
    realtimeUsage.input_tokens += usage.input_tokens || 0;
    realtimeUsage.output_tokens += usage.output_tokens || 0;
    const inD = usage.input_token_details || {};
    realtimeUsage.input_text_tokens += inD.text_tokens || 0;
    realtimeUsage.input_audio_tokens += inD.audio_tokens || 0;
    realtimeUsage.input_cached_tokens += inD.cached_tokens || 0;
    const cD = inD.cached_tokens_details || {};
    realtimeUsage.input_cached_text_tokens += cD.text_tokens || 0;
    realtimeUsage.input_cached_audio_tokens += cD.audio_tokens || 0;
    const outD = usage.output_token_details || {};
    realtimeUsage.output_text_tokens += outD.text_tokens || 0;
    realtimeUsage.output_audio_tokens += outD.audio_tokens || 0;
  }

  // --- Provider detection ---
  const pathname = url.parse(req.url).pathname || "/";
  const isElks = pathname.startsWith("/elks");
  const provider = isElks ? "46elks" : "telnyx";

  // For 46elks: wait for "hello" message to get call metadata before proceeding.
  // 46elks connects directly (no n8n intermediary).
  let elksHello = null;
  if (isElks) {
    const helloRaw = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("46elks hello timeout")), 10000);
      phoneWs.once("message", (raw) => { clearTimeout(timeout); resolve(raw); });
      phoneWs.once("close", () => { clearTimeout(timeout); reject(new Error("closed before hello")); });
    }).catch((err) => {
      logError("elks_hello_error", { trace_id, error: err.message });
      return null;
    });
    if (!helloRaw) { try { phoneWs.close(); } catch (_) {} return; }
    elksHello = JSON.parse(helloRaw.toString());
    if (elksHello.t !== "hello") {
      logError("elks_unexpected_message", { trace_id, type: elksHello.t });
      try { phoneWs.close(); } catch (_) {} return;
    }
    log("elks_hello", { trace_id, callid: elksHello.callid, from: elksHello.from, to: elksHello.to });

    // Tell 46elks we want pcm_24000 (24kHz) — maps directly to OpenAI pcm16
    phoneWs.send(JSON.stringify({ t: "listening", format: "pcm_24000" }));
    phoneWs.send(JSON.stringify({ t: "sending", format: "pcm_24000" }));
  }

  // Audio format: 46elks uses pcm16 (24kHz HD), Telnyx uses g711_ulaw (8kHz)
  const audioFormat = isElks ? "pcm16" : "g711_ulaw";

  // --- Tenant resolution ---
  const query = url.parse(req.url, true).query;
  const tenantId = query.tenant || DEFAULT_TENANT_ID;
  const callerNumber = isElks
    ? (elksHello?.from || null)
    : (query.caller ? query.caller.trim().replace(/^(\d)/, "+$1") : null);
  const sessionId = query["session-id"] || null;
  const callControlId = query["call_control_id"] || query["control-id"] || null;
  let leadName     = query.lead_name     ? decodeURIComponent(query.lead_name).trim()     : null;
  let leadBusiness = query.lead_business ? decodeURIComponent(query.lead_business).trim() : null;
  let leadWebsite  = query.lead_website  ? decodeURIComponent(query.lead_website).trim()  : null;

  // For 46elks outbound: the WSS URL is static (configured in dashboard), so lead params
  // aren't in the query string. Fetch them from telephony-service using the callid.
  if (isElks && elksHello?.callid && process.env.TELEPHONY_URL) {
    try {
      const ctxRes = await fetch(
        `${process.env.TELEPHONY_URL}/webhooks/elks/context/${encodeURIComponent(elksHello.callid)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (ctxRes.ok) {
        const ctx = await ctxRes.json();
        leadName     = ctx.lead_name     || leadName;
        leadBusiness = ctx.lead_business || leadBusiness;
        leadWebsite  = ctx.lead_website  || leadWebsite;
        log("elks_context_fetched", { trace_id, callid: elksHello.callid, lead_name: leadName, lead_business: leadBusiness });
      }
    } catch (err) {
      log("elks_context_fetch_failed", { trace_id, error: err.message });
    }
  }

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

  // Inject prior call context if this caller has a case on file for this tenant.
  // Gives the agent awareness of previous calls without manual memory management.
  if (!fallback && callerNumber) {
    const priorContext = await fetchPriorCaseContext(callerNumber, tenantId);
    if (priorContext) instructions += priorContext;
  }

  // For outbound calls: scrape lead website and prepend lead context block to instructions.
  // lead_name, lead_business, lead_website come in as query params on the WSS URL.
  if (!fallback && tenantConfig.direction === "outbound" && (leadName || leadBusiness)) {
    const websiteSummary = leadWebsite ? await scrapeLeadWebsite(leadWebsite) : null;
    const leadBlock = buildLeadContext(leadName, leadBusiness, websiteSummary);
    instructions = leadBlock + "\n\n" + instructions;
  }

  const voice = tenantConfig?.voice || DEFAULT_VOICE;
  const realtimeModel = tenantConfig?.realtime_model || DEFAULT_REALTIME_MODEL;
  const reasoningEffort = tenantConfig?.reasoning_effort || null;
  const entryMode = tenantConfig?.entry_mode || "unknown";
  let firstMessage = !fallback && tenantConfig.first_message_enabled
    ? (tenantConfig.first_message || null)
    : null;
  if (firstMessage) {
    firstMessage = firstMessage.replace(/\{\{lead_name\}\}/g,     leadName ? leadName.split(" ")[0] : "");
    firstMessage = firstMessage.replace(/\{\{lead_business\}\}/g, leadBusiness || "");
    firstMessage = firstMessage.replace(/\s{2,}/g, " ").trim();
  }
  const firstMessageDelayMs = tenantConfig?.first_message_delay_ms || 0;
  const transcriptionLanguage = tenantConfig?.transcription_language || null;
  const vadThreshold       = tenantConfig?.vad_threshold       ?? 0.5;
  const silenceDurationMs  = tenantConfig?.silence_duration_ms  ?? 500;
  const prefixPaddingMs    = tenantConfig?.prefix_padding_ms    ?? 300;
  let audioForwardingReady = (firstMessageDelayMs === 0); // hold off during welcome audio

  log("call_start", {
    trace_id,
    tenant_id: tenantId || null,
    provider,
    audio_format: audioFormat,
    session_id: sessionId,
    caller_number: callerNumber,
    call_control_id: callControlId,
    elks_callid: elksHello?.callid || null,
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
  const isGAModel = realtimeModel !== "gpt-realtime-1.5";

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${realtimeModel}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        // Beta header required for gpt-realtime-1.5; GA models reject it
        ...(isGAModel ? {} : { "OpenAI-Beta": "realtime=v1" }),
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

    // Map internal audio format string to API format objects.
    // GA API requires `rate` for PCM (46elks 24kHz HD); PCMU is fixed at 8kHz.
    const gaAudioFormat = audioFormat === "g711_ulaw"
      ? { type: "audio/pcmu", rate: 8000 }
      : { type: "audio/pcm", rate: 24000 };

    // Build tools
    let tools;
    if (workflowEnabled) {
      const transferTools = generateWorkflowTools(tenantConfig, currentMode);
      tools = initialModeType === "leaf" ? [END_CALL_TOOL, ...transferTools] : transferTools;
    } else {
      tools = [END_CALL_TOOL];
    }

    let sessionPayload;

    if (isGAModel) {
      // GA API (gpt-realtime-2+) — nested audio object, renamed fields
      sessionPayload = {
        type: "realtime",
        instructions,
        tools,
        tool_choice: "auto",
        audio: {
          input: {
            format: gaAudioFormat,
            transcription: {
              model: "gpt-realtime-whisper",
              ...(transcriptionLanguage && { language: transcriptionLanguage }),
            },
            turn_detection: {
              type: "server_vad",
              threshold: vadThreshold,
              prefix_padding_ms: prefixPaddingMs,
              silence_duration_ms: silenceDurationMs,
            },
          },
          output: {
            format: gaAudioFormat,
            voice,
          },
        },
        ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
      };
    } else {
      // Beta API (gpt-realtime-1.5) — flat session fields
      sessionPayload = {
        voice,
        instructions,
        input_audio_format: audioFormat,
        output_audio_format: audioFormat,
        input_audio_transcription: {
          model: "whisper-1",
          ...(transcriptionLanguage && { language: transcriptionLanguage }),
        },
        turn_detection: {
          type: "server_vad",
          threshold: vadThreshold,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools,
        tool_choice: "auto",
      };
    }

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

  // --- Phone -> OpenAI ---
  phoneWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!openaiReady || transferFired || !audioForwardingReady) return;

      if (isElks) {
        // 46elks: { t: "audio", data: "<base64>" }
        if (msg.t === "audio" && msg.data) {
          openaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.data
          }));
        }
        if (msg.t === "bye") {
          log("elks_bye", { trace_id, tenant_id: tenantId || null, reason: msg.reason, message: msg.message });
          openaiWs.close();
        }
      } else {
        // Telnyx (via n8n): { event: "media", media: { payload: "<base64>" } }
        if (msg.event === "media" && msg.media?.payload) {
          openaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload
          }));
        }
        if (msg.event === "stop") {
          openaiWs.close();
        }
      }
    } catch (err) {
      logError("phone_parse_error", { trace_id, tenant_id: tenantId || null, provider, error: err.message });
    }
  });

  // --- OpenAI -> Telnyx ---
  openaiWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case "input_audio_buffer.speech_started": {
          const phoneActive = Date.now() < phoneAudioActiveUntil;
          const hasActiveItem = !!currentAssistantItemId;
          log("speech_started", {
            trace_id, tenant_id: tenantId || null,
            turn_user: turnCountUser + 1,
            assistant_audio_ms: assistantAudioMs,
            ms_since_response_started: responseStartedAt ? Date.now() - responseStartedAt : null,
            had_active_item: hasActiveItem,
            phone_audio_still_playing: phoneActive && !hasActiveItem,
          });
          // Two reasons to fire a barge-in:
          // (1) OpenAI is actively generating → cancel + truncate
          // (2) OpenAI is done but phone audio is still buffered/playing → clear the buffer
          if (isElks && (hasActiveItem || phoneActive)) {
            let interruptSent = false;
            try { phoneWs.send(JSON.stringify({ t: "interrupt" })); interruptSent = true; } catch (e) {
              logError("elks_interrupt_send_failed", { trace_id, error: e.message });
            }
            elksNeedsSendingHeader = true;
            // Only send response.cancel + truncate when OpenAI actually has an active response.
            // After response_done the item is completed and these would error.
            if (hasActiveItem) {
              const truncItem = currentAssistantItemId;
              const truncMs = assistantAudioMs;
              openaiWs.send(JSON.stringify({ type: "response.cancel" }));
              openaiWs.send(JSON.stringify({
                type: "conversation.item.truncate",
                item_id: truncItem,
                content_index: 0,
                audio_end_ms: truncMs,
              }));
            }
            log("barge_in_fired", {
              trace_id, tenant_id: tenantId || null,
              item_id: currentAssistantItemId,
              truncate_at_ms: assistantAudioMs,
              ms_since_response_started: responseStartedAt ? Date.now() - responseStartedAt : null,
              reason: hasActiveItem ? "active_response" : "phone_audio_buffered",
              elks_interrupt_sent: interruptSent,
            });
            lastBargeInAt = Date.now();
            audioDeltasAfterBargeIn = 0;
            audioBytesAfterBargeIn = 0;
            currentAssistantItemId = null;
            assistantAudioMs = 0;
            phoneAudioActiveUntil = 0;
          }
          break;
        }

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
            // GA API doesn't fire conversation.item.created for user audio — count here instead
            if (isGAModel) {
              turnCountUser++;
              log("user_turn", { trace_id, tenant_id: tenantId || null, turn_user: turnCountUser });
            }
            log("user_transcript", { trace_id, tenant_id: tenantId || null, turn_user: turnCountUser, text: msg.transcript });
            transcripts.push({ role: "user", message: msg.transcript, time_in_call_secs: Math.round((Date.now() - callStart) / 1000) });
          }
          break;

        case "response.audio_transcript.done":       // beta
        case "response.output_audio_transcript.done": // GA
          if (msg.transcript) {
            log("assistant_transcript", { trace_id, tenant_id: tenantId || null, turn_assistant: turnCountAssistant + 1, text: msg.transcript });
            transcripts.push({ role: "agent", message: msg.transcript, time_in_call_secs: Math.round((Date.now() - callStart) / 1000) });
          }
          break;

        case "response.created":
          log("response_started", {
            trace_id, tenant_id: tenantId || null,
            turn_assistant: turnCountAssistant + 1,
            response_id: msg.response?.id || null,
            ms_since_barge_in: lastBargeInAt ? Date.now() - lastBargeInAt : null,
          });
          responseStartedAt = Date.now();
          assistantAudioMsThisResponse = 0;
          break;

        case "response.audio.delta":        // beta
        case "response.output_audio.delta": // GA
          if (msg.delta && !transferFired) {
            if (!firstAudioSent) {
              firstAudioSent = true;
              log("first_audio_token", {
                trace_id,
                tenant_id: tenantId || null,
                latency_ms: Date.now() - callStart,
              });
            }
            // Track when item_id transitions (new response taking over from cancelled one).
            if (msg.item_id && msg.item_id !== currentAssistantItemId) {
              log("assistant_item_changed", {
                trace_id, tenant_id: tenantId || null,
                from: currentAssistantItemId, to: msg.item_id,
                ms_since_barge_in: lastBargeInAt ? Date.now() - lastBargeInAt : null,
              });
              currentAssistantItemId = msg.item_id;
            } else if (msg.item_id) {
              currentAssistantItemId = msg.item_id;
            }
            // Count deltas that arrive AFTER a barge-in for the same response (cancel lag).
            if (lastBargeInAt && Date.now() - lastBargeInAt < 3000) {
              audioDeltasAfterBargeIn++;
              audioBytesAfterBargeIn += msg.delta.length;
            }
            // G.711 ulaw: 8000 samples/sec, 1 byte/sample, base64 → each char ≈ 0.75 bytes
            // PCM 24kHz (elks): 24000 samples/sec × 2 bytes = 48000 bytes/sec
            const deltaMs = isElks
              ? Math.round((msg.delta.length * 0.75) / 48)
              : Math.round((msg.delta.length * 0.75) / 8);
            assistantAudioMs += deltaMs;
            assistantAudioMsThisResponse += deltaMs;
            if (isElks) {
              // After an interrupt, 46elks requires a new { t: "sending" } before audio resumes
              if (elksNeedsSendingHeader) {
                phoneWs.send(JSON.stringify({ t: "sending", format: "pcm_24000" }));
                elksNeedsSendingHeader = false;
              }
              phoneWs.send(JSON.stringify({ t: "audio", data: msg.delta }));
            } else {
              phoneWs.send(JSON.stringify({ event: "media", media: { payload: msg.delta } }));
            }
          }
          break;

        case "response.output_item.done":
          // Handle function tool calls at the canonical event (fires before response.done)
          if (msg.item?.type === "function_call" && msg.item?.status === "completed") {
            const fnName = msg.item.name;

            if (fnName === "end_call") {
              // Guard: agent must say a real farewell before hanging up. If end_call
              // fires in a response with effectively no spoken audio, reject and force
              // the model to speak first.
              const FAREWELL_MIN_MS = 600;
              if (assistantAudioMsThisResponse < FAREWELL_MIN_MS) {
                log("end_call_blocked_no_farewell", {
                  trace_id, tenant_id: tenantId || null,
                  call_id: msg.item.call_id,
                  audio_ms_this_response: assistantAudioMsThisResponse,
                });
                openaiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: msg.item.call_id,
                    output: JSON.stringify({
                      success: false,
                      error: "Du måste säga ett kort avsked till uppringaren (t.ex. 'Tack för pratstunden, ha en bra dag!') INNAN du ringer end_call. Försök igen efter att du sagt hejdå."
                    })
                  }
                }));
                openaiWs.send(JSON.stringify({ type: "response.create" }));
                break;
              }
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
                sessionUpdate.output_audio_format = audioFormat;
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
          addRealtimeUsage(msg.response?.usage);
          log("response_done", {
            trace_id, tenant_id: tenantId || null,
            turn_assistant: turnCountAssistant,
            status: msg.response?.status || null,
            status_details: msg.response?.status_details?.reason || msg.response?.status_details?.type || null,
            response_id: msg.response?.id || null,
            duration_ms: responseStartedAt ? Date.now() - responseStartedAt : null,
            audio_deltas_after_barge_in: audioDeltasAfterBargeIn,
            audio_bytes_after_barge_in: audioBytesAfterBargeIn,
          });
          // Keep audio-playback grace window so late user interrupts still clear 46elks buffer.
          // Phone audio finishes playing roughly assistantAudioMsThisResponse from when streaming
          // started; cap at 3.5s to avoid swallowing legitimate next-turn user speech.
          phoneAudioActiveUntil = Date.now() + Math.min(assistantAudioMsThisResponse || 0, 3500);
          currentAssistantItemId = null;
          assistantAudioMs = 0;
          responseStartedAt = null;
          audioDeltasAfterBargeIn = 0;
          audioBytesAfterBargeIn = 0;
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

  // --- Hangup ---
  function fireHangup() {
    log("hangup_attempt", { trace_id, tenant_id: tenantId || null, provider });

    if (isElks) {
      // 46elks: send bye message — 46elks flushes buffered audio before disconnecting
      try { phoneWs.send(JSON.stringify({ t: "bye" })); } catch (_) {}
      log("hangup_sent", { trace_id, tenant_id: tenantId || null, provider: "46elks" });
      return;
    }

    // Telnyx: Call Control API hangup
    if (!callControlId || !TELNYX_API_KEY) {
      logError("hangup_skipped", { trace_id, tenant_id: tenantId || null, reason: !callControlId ? "no call_control_id" : "no TELNYX_API_KEY" });
      return;
    }
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
  // Async because Phase B.2 writes call_sessions to Firestore and we need to await
  // it before the container's CPU is throttled (Cloud Run pauses background work
  // after the active connection ends).
  let callEnded = false;
  async function endCall() {
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
    // Don't close phone WS if a phone transfer is active — Telnyx manages the connection
    if (!transferFired) {
      try { phoneWs.close(); } catch (_) {}
    }

    // Phase B.2: append bridge-side data to call_sessions/<call_control_id>.
    // AWAITED — Cloud Run throttles CPU after the active connection ends, so
    // fire-and-forget would silently lose the write.
    try {
      await writeCallSessionBridgeData({
        callControlId,
        traceId: trace_id,
        tenantId,
        direction: tenantConfig?.direction || (isElks ? "outbound" : null),
        transcript: transcripts,
        turnCountUser,
        turnCountAssistant,
        durationMs,
        voice,
        realtimeModel,
        visitedModes,
        currentMode,
        workflowEnabled,
        transferFired,
        realtimeUsage,
      });
    } catch (err) {
      logError("call_session_bridge_unhandled", { trace_id, error: err.message });
    }

    // --- Fire post-processor immediately (replaces every-minute polling) ---
    // Fire-and-forget: don't await. If this fails, the hourly safety-net scheduler picks it up.
    // Use call_control_id when available (Telnyx) or trace_id (46elks) — call_sessions
    // doc id matches whichever side seeded the doc.
    const ppDocId = callControlId || trace_id;
    if (ppDocId && process.env.POST_PROCESSOR_URL) {
      const ppUrl = `${process.env.POST_PROCESSOR_URL.replace(/\/$/, "")}/process`;
      const ppHeaders = { "Content-Type": "application/json" };
      if (process.env.POST_PROCESSOR_SECRET) {
        ppHeaders.Authorization = `Bearer ${process.env.POST_PROCESSOR_SECRET}`;
      }
      fetch(ppUrl, {
        method: "POST",
        headers: ppHeaders,
        body: JSON.stringify({ call_control_id: ppDocId }),
      })
        .then((r) => log("post_processor_triggered", { trace_id, doc_id: ppDocId, status: r.status }))
        .catch((err) => logError("post_processor_trigger_failed", { trace_id, error: err.message }));
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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            log("webhook_sent", { trace_id, tenant_id: tenantId, status: res.statusCode });
          } else {
            logError("webhook_error", { trace_id, tenant_id: tenantId, status: res.statusCode });
          }
          res.resume();
        });
        webhookReq.on("error", (err) => {
          logError("webhook_error", { trace_id, tenant_id: tenantId, error: err.message || String(err) });
        });
        webhookReq.write(reqData);
        webhookReq.end();
      } catch (err) {
        logError("webhook_error", { trace_id, tenant_id: tenantId, error: err.message || String(err) });
      }
    }
  }

  phoneWs.on("close", endCall);
  openaiWs.on("close", endCall);

  phoneWs.on("error", (err) =>
    logError("phone_ws_error", { trace_id, tenant_id: tenantId || null, provider, error: err.message })
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
