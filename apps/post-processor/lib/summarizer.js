/**
 * lib/summarizer.js
 *
 * Generates a dentist-chart-style summary from a call transcript. Cheap model
 * by default (gpt-4o-mini), overridable via SUMMARIZER_MODEL env var.
 *
 * The output is a structured object — intent, outcome, urgency, suggested_action,
 * and a plain-language summary text. Stored in call_sessions/<id>.summary.
 *
 * Voice: factual, dictated-chart style. No marketing fluff. Same language as
 * the transcript (Swedish here).
 */

const { logError } = require("./log");

const MODEL = process.env.SUMMARIZER_MODEL || "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 30000;

function getApiKey() {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new Error("OPENAI_API_KEY not set");
  return k;
}

const SYSTEM_PROMPT = `You are a clinical-style summarizer for a Swedish phone-based AI receptionist platform.

Generate a factual, dictated-chart-style summary of the call below. Mimic how a dentist or clinician writes a chart note: brief, factual, action-oriented. No marketing language, no sentiment claims ("had a great experience"), no editorializing.

Rules:
- Write in the SAME LANGUAGE as the transcript (typically Swedish).
- 2 to 4 sentences max.
- State: who called, what they wanted, what the agent did, what action is needed (if any).
- If the agent failed to handle the call (e.g. got stuck, never responded, gave wrong info), say so plainly.
- If the caller hung up without explaining their issue, note that.

Output JSON with EXACTLY these keys:
{
  "summary":           "string — 2-4 sentence factual summary in the call's language",
  "intent":            "string — one of: booking | reschedule | cancellation | message | payment | sales | late | urgent | called_by_clinic | other | unknown",
  "outcome":           "string — one of: appointment_scheduled | appointment_changed | appointment_cancelled | message_taken | transferred_human | transferred_phone | information_given | no_action | abandoned | agent_failed",
  "urgency":           "string — one of: normal | urgent",
  "requires_followup": true | false,
  "suggested_action":  "string — short action description, or null"
}

Return ONLY the JSON object, no markdown fences, no commentary.`;

function transcriptToText(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return "(no transcript captured)";
  }
  return transcript
    .map((t) => {
      const role = t.role || "?";
      const text = t.message || t.text || JSON.stringify(t);
      const at = t.time_in_call_secs != null ? `[${t.time_in_call_secs}s] ` : "";
      return `${at}${role.toUpperCase()}: ${text}`;
    })
    .join("\n");
}

function buildContext(callDoc) {
  const fromMasked = callDoc.from_number || "(unknown caller)";
  const tenant = callDoc.tenant_id || "(unknown tenant)";
  const durationSec = callDoc.duration_ms ? Math.round(callDoc.duration_ms / 1000) : "?";
  const hangupCause = callDoc.hangup_cause || "?";
  const visited = (callDoc.visited_modes || []).join(" → ") || "(no workflow)";
  const transcript = transcriptToText(callDoc.transcript || []);

  return `Tenant: ${tenant}
Caller: ${fromMasked}
Duration: ${durationSec}s
Hangup cause: ${hangupCause}
Workflow path: ${visited}
Final mode: ${callDoc.final_mode || "(none)"}
Turn counts: user=${callDoc.turn_count_user || 0}, assistant=${callDoc.turn_count_assistant || 0}

Transcript:
${transcript}`;
}

async function summarize(callDoc, traceId) {
  const userMessage = buildContext(callDoc);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenAI HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content in OpenAI response");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Summarizer returned invalid JSON: ${content.slice(0, 200)}`);
    }

    return {
      summary: parsed,
      tokens: json.usage || null,
      model: MODEL,
    };
  } catch (err) {
    clearTimeout(timer);
    logError("summarizer_error", { trace_id: traceId, error: err.message });
    throw err;
  }
}

module.exports = { summarize };
