# Phase B — Structured post-call object (design)

Status: design / not yet implemented. Implementation gated on Phase A cutover being live and stable.

Per developer brief §14: every call must produce a standardized post-call object. The transcript alone is raw material; the post-call object is the operational product output that the dashboard, email summaries, CRM integrations, billing, and feedback loops all depend on.

---

## Where the data lives today (problem)

| Data | Source | Persisted? |
|---|---|---|
| Call metadata (to/from, hangup_cause, duration) | Telnyx webhook | No — only Cloud Logging via telephony-service |
| Transcript (user + assistant turns) | OpenAI Realtime events in voice-bridge | No — only Cloud Logging |
| Mode-switching history | voice-bridge | No — only Cloud Logging |
| Tool calls (end_call, phone transfers) | voice-bridge | No — only Cloud Logging |
| Errors during the call | voice-bridge | No — only Cloud Logging |

Cloud Logging keeps these for 30 days by default but they're not query-friendly for anything other than debugging a specific trace_id. We need them in Firestore, joined into one document per call.

## The post-call object (Firestore `call_sessions/<call_id>`)

`call_id` = Telnyx `call_session_id` (stable across the call, distinct from `call_control_id` which is per-leg).

```jsonc
{
  // Identifiers
  "call_id":         "<telnyx_call_session_id>",
  "call_control_id": "<telnyx_ccid>",
  "trace_id":        "<uuid>",            // also goes to Cloud Logging — joins logs to doc

  // Routing
  "tenant_id":   "alvsjo-tandvard",
  "to_number":   "+46105201311",
  "from_number": "+46701234567",
  "direction":   "inbound",               // | "outbound" (future)

  // Lifecycle
  "status":         "active" | "completed" | "failed" | "abandoned",
  "initiated_at":   <ts>,
  "answered_at":    <ts>,
  "hangup_at":      <ts>,
  "duration_ms":    12345,
  "hangup_cause":   "<from telnyx>",
  "hangup_source":  "<from telnyx>",

  // Content (synthesized post-hangup from Cloud Logging — see "Assembly" below)
  "turn_count_user":      5,
  "turn_count_assistant": 6,
  "transcript": [
    { "role": "assistant", "text": "Hej och välkommen", "ts": <ts> },
    { "role": "user",      "text": "Hej, jag vill boka tid", "ts": <ts> }
  ],

  // Workflow trace (for mode-switching tenants)
  "mode_history": [
    { "mode": "INTAKE",  "entered_at": <ts> },
    { "mode": "BOOKING", "entered_at": <ts> }
  ],

  // Tools the agent invoked
  "tool_calls": [
    { "name": "transfer_to_booking", "at": <ts> },
    { "name": "end_call",            "at": <ts> }
  ],

  // Quality signals
  "errors": [
    { "event": "openai_error", "at": <ts>, "details": "<msg>" }
  ],

  // Summary — filled in by the post-processor (async, after hangup)
  "summary": {
    "text":              "Caller wanted to book an appointment for acute tooth pain. Transferred to booking line.",
    "intent":            "booking",
    "outcome":           "appointment_scheduled" | "transferred" | "no_action" | "abandoned",
    "urgency":           "normal" | "urgent",
    "requires_followup": false,
    "suggested_action":  "send_booking_confirmation"
  },

  // Side-effect tracking (Phase C/D will populate these)
  "email_sent":        false,
  "email_sent_at":     null,
  "sms_sent":          false,
  "crm_sync_status":   null
}
```

## Assembly strategy (chosen approach: Option C — minimal bridge changes)

The voice-bridge already logs every call lifecycle event to Cloud Logging with `trace_id`. We don't need to change the bridge to write Firestore directly. Instead:

```
Telnyx → telephony-service → writes call_sessions doc
                              with metadata as the call progresses
                              (initiated → answered → hangup)

OpenAI Realtime → voice-bridge → logs to Cloud Logging
                                  (existing structured tracing)

After hangup → post-processor (new) → reads doc + Cloud Logging events
                                       → synthesizes transcript, turn counts,
                                          tool_calls, errors, mode_history
                                       → calls GPT to generate summary
                                       → writes back to the same doc
```

**Why Option C:**
- Bridge stays untouched — it's the production-critical hot path. No new dependency, no new latency, no new failure mode mid-call.
- All call data already exists in Cloud Logging via the structured tracing we shipped earlier.
- Post-processor runs out-of-band, so a slow/failing summarizer never affects a live call.

**Why not Option A (both write the same doc concurrently):**
- Risk of race conditions on array fields (transcript, mode_history, tool_calls).
- Harder failure semantics — if the bridge crashes mid-write, the doc is half-written.

**Why not Option B (bridge writes separate collection):**
- Adds a Firestore dependency to the bridge for non-critical data.
- Forces a join at read time anyway — same complexity as Option C without the upside.

## Components Phase B will add

1. **`apps/telephony/routes/webhooks.js`** — extend the existing handlers:
   - On `call.initiated`: also create `call_sessions/<call_session_id>` with `status: "active"` + initial metadata
   - On `call.answered`: update `answered_at`
   - On `call.hangup`: update `status: "completed"`, `hangup_at`, `duration_ms`, then enqueue post-processing

2. **New service: `apps/post-processor/`** — Cloud Run job (or Cloud Function) triggered after each hangup:
   - Input: `{ call_id, trace_id }`
   - Reads `call_sessions/<call_id>`
   - Queries Cloud Logging for `trace_id` events
   - Builds transcript, turn counts, mode_history, tool_calls, errors
   - Calls OpenAI (gpt-4o-mini or similar) with transcript → generates summary fields
   - Writes back to `call_sessions/<call_id>` (merge)
   - Emits `post_call_complete` log event

3. **Trigger mechanism** — two options:
   - (a) Telephony enqueues to Cloud Tasks after writing `status: completed`, post-processor consumes the task
   - (b) Firestore trigger on document update where `status` becomes `completed`
   - Recommend (a) for visibility and retry control

4. **Retention policy**:
   - Keep summary fields forever (cheap, they're the operational record)
   - Keep raw transcript for 30 days (configurable per tenant for GDPR)
   - Cloud Logging events expire on Cloud Logging's normal retention (30 days)

5. **Operator endpoints** in control-plane:
   - `GET /calls?tenant=<id>&since=<iso>` — list calls (summary view)
   - `GET /calls/:call_id` — full post-call object
   - `POST /calls/:call_id/reprocess` — re-run the post-processor (useful when summary prompts change)
   - `POST /calls/:call_id/feedback` — operator/customer marks call as good/bad/needs-followup (Phase B/16 in brief)

## Decisions to make before Phase B implementation

1. **Summarizer model** — `gpt-4o-mini` for cost? `gpt-4.1` for quality? Per-tenant override?
2. **Trigger** — Cloud Tasks vs Firestore trigger?
3. **Retention** — default 30 days for transcripts? Per-tenant configurable?
4. **PII handling** — should we redact phone numbers / names in the stored transcript? Or rely on access control?
5. **Tenant-specific summary templates** — does enkla-juridik need a different summary structure than alvsjo-tandvard? (The brief implies yes — different intents per niche.)

These are answered before writing code, not during.

## What this unlocks (downstream phases)

- **Phase C (SMS)** — needs `summary.suggested_action` to know when to send a confirmation SMS
- **Phase D (Outbound)** — outbound call campaigns key off post-call objects (last contact, outcome)
- **Phase F (Customer dashboard)** — IS this collection, rendered. The dashboard is a thin UI on top of `call_sessions` + the operator endpoints.
- **Brief §15-16 (customer feedback loop)** — the `feedback` field on each call_session doc is where good/bad/needs-followup gets recorded

## Estimated effort

3–4 working sessions:
- Session 1: extend telephony webhooks + Firestore writer + Cloud Tasks queue
- Session 2: post-processor service (transcript assembly + summarizer)
- Session 3: control-plane endpoints + ops scripts (`call-list.js`, `call-show.js`, `call-reprocess.js`)
- Session 4: validate against real cutover-tenant calls, tune the summary prompt
