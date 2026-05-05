"use strict";
/**
 * routes/sms.js
 *
 * SMS via 46elks.
 *
 *   POST /sms/send     — outbound SMS, writes sms_session to Firestore
 *   POST /sms/inbound  — 46elks webhook: AI-parses reply → updates case, or sends fallback
 *   GET  /sms          — list sms_sessions (dashboard / ops)
 *
 * Routing: sms_sessions maps (customer_phone × elk_number) → tenant_id + case_id.
 * Sessions expire after 7 days. No reply after expiry → no action.
 *
 * Cost per outbound SMS:
 *   cost_elk_ore        — what 46elks charged (in öre)
 *   cost_customer_sek   — 3.50 SEK × segments billed to tenant
 *
 * Fallback policy (no AI conversation):
 *   - Customer sends contact info → parse with gpt-4o-mini, update case, done.
 *   - Customer sends something else + no email on file →
 *       "Only for contact details. Reply with name, email, ort so [specialist] can reach you."
 *   - Customer sends something else + email already known →
 *       "Already processed. [Specialist] will contact you within 48h. Email for support."
 *   - fallback_sent flag prevents repeat responses — no further replies ever.
 *
 * Requires env: OPENAI_API_KEY (mount from Secret Manager for control-plane service)
 */

const express = require("express");
const router = express.Router();
const https = require("https");
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore");
const { syncPipefyForCase } = require("../lib/pipefy-sync");
const { alertOnLeadInquiry, alertOnError } = require("../lib/alert");

const SMS_SESSIONS = "sms_sessions";
const CASES        = "cases";

// Cost config
const COST_PER_SEGMENT_SEK = 3.50;

function elkAuth() {
  const user = process.env.ELK_API_USER;
  const pass = process.env.ELK_API_PASS;
  if (!user || !pass) throw new Error("ELK_API_USER / ELK_API_PASS not configured");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}
const ELK_FROM_NUMBER = process.env.ELK_FROM_NUMBER || "+46766860841";
const SESSION_TTL_DAYS = 7;

// Default messages — overridden per tenant via tenant_settings Firestore doc.
// [specialist] is replaced at runtime with sms_specialist_title (e.g. "jurist").

const DEFAULT_POST_CALL_MESSAGE =
  "Hej! Tack för att du kontaktade oss. För att en [specialist] ska kunna " +
  "kontakta dig, svara med dina uppgifter:\n" +
  "Förnamn Efternamn, din@email.se, Stad";

// Sent when reply is not contact info AND we don't yet have the customer's email.
const DEFAULT_FALLBACK_NEEDS_INFO =
  "Det här är enbart för kontaktuppgifter. Svara med ditt namn, " +
  "e-postadress och ort så att en [specialist] kan kontakta dig.";

// Sent when reply is not contact info AND we already have the customer's email.
const DEFAULT_FALLBACK_ALREADY_PROCESSED =
  "Det här är enbart för kontaktuppgifter. Vi har redan tagit emot dina " +
  "uppgifter och en [specialist] hör av sig inom 48 timmar. " +
  "Kontakta oss på [contact_email] för frågor och support.";

// Sent by /sms/reminders/run — reminder 1 (24h after first contact).
const DEFAULT_REMINDER_1_MESSAGE =
  "Hej! Vi väntar fortfarande på dina kontaktuppgifter för att en [specialist] " +
  "ska kunna kontakta dig. Svara med:\nNamn, din@email.se, Stad";

// Sent by /sms/reminders/run — reminder 2 (24h after reminder 1). Last attempt.
const DEFAULT_REMINDER_2_MESSAGE =
  "Sista påminnelse: Svara med ditt namn, din e-postadress och stad så att " +
  "en [specialist] kan kontakta dig. Annars hör vi inte av oss.";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

// ── Segment count ─────────────────────────────────────────────────────────────
// Swedish chars (å ä ö etc.) are in GSM-7 → 160/153 limits apply.
// Emoji or other Unicode → 70/67 limits.
function countSegments(text) {
  const hasNonGsm = /[^ -À-ÿŒœŸ]/u.test(text);
  // Latin-1 (incl. å ä ö, \n, \r, tab) is GSM-7 = 160/153. Codepoint > 0xFF → UCS-2 = 70/67.
  const isUnicode = /[^ -ÿ]/u.test(text);
  const singleLimit = isUnicode ? 70 : 160;
  const multiLimit  = isUnicode ? 67 : 153;
  if (text.length <= singleLimit) return 1;
  return Math.ceil(text.length / multiLimit);
}

// ── Tenant SMS config ─────────────────────────────────────────────────────────
async function getTenantSmsConfig(tenantId) {
  try {
    const snap = await getDb().collection("tenant_settings").doc(tenantId).get();
    const s = snap.exists ? snap.data() : {};
    const specialist   = s.sms_specialist_title || "specialist";
    const contactEmail = s.sms_contact_email    || null;

    const interpolate = (template) =>
      template
        .replace(/\[specialist\]/g, specialist)
        .replace(/\[contact_email\]/g, contactEmail || "oss");

    return {
      postCallMessage:          interpolate(s.sms_post_call_message          || DEFAULT_POST_CALL_MESSAGE),
      fallbackNeedsInfo:        interpolate(s.sms_fallback_needs_info        || DEFAULT_FALLBACK_NEEDS_INFO),
      fallbackAlreadyProcessed: interpolate(s.sms_fallback_already_processed || DEFAULT_FALLBACK_ALREADY_PROCESSED),
      reminder1Message:         interpolate(s.sms_reminder_1_message         || DEFAULT_REMINDER_1_MESSAGE),
      reminder2Message:         interpolate(s.sms_reminder_2_message         || DEFAULT_REMINDER_2_MESSAGE),
      contactEmail,
      specialist,
    };
  } catch {
    const fb = (t) => t.replace(/\[specialist\]/g, "specialist").replace(/\[contact_email\]/g, "oss");
    return {
      postCallMessage:          fb(DEFAULT_POST_CALL_MESSAGE),
      fallbackNeedsInfo:        fb(DEFAULT_FALLBACK_NEEDS_INFO),
      fallbackAlreadyProcessed: fb(DEFAULT_FALLBACK_ALREADY_PROCESSED),
      reminder1Message:         fb(DEFAULT_REMINDER_1_MESSAGE),
      reminder2Message:         fb(DEFAULT_REMINDER_2_MESSAGE),
      contactEmail:             null,
      specialist:               "specialist",
    };
  }
}

// ── 46elks send ───────────────────────────────────────────────────────────────
function sendElkSMS(to, message) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ from: ELK_FROM_NUMBER, to, message }).toString();
    const req = https.request(
      {
        hostname: "api.46elks.com",
        path: "/a1/SMS",
        method: "POST",
        headers: {
          Authorization: elkAuth(),
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(params),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            const body = JSON.parse(raw);
            if (res.statusCode >= 400) reject(new Error(`46elks ${res.statusCode}: ${raw}`));
            else resolve(body);
          } catch (e) {
            reject(new Error(`46elks parse: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(params);
    req.end();
  });
}

// ── GPT-4o-mini contact info parser ──────────────────────────────────────────
// Returns { name, email, city, is_contact_info }
// is_contact_info = false when the message is not an attempt to send contact details.
async function parseContactInfo(message) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY not set on control-plane");

  const systemPrompt = `You extract contact details from a customer SMS reply.
The customer was asked to send their name, email address, and city.

Respond with ONLY a JSON object. No markdown, no explanation.

If the message contains contact details (even partial, even messily formatted):
{ "is_contact_info": true, "name": "...", "email": "...", "city": "..." }
Use null for fields you cannot find. Email must be a valid email address.

If the message is clearly NOT an attempt to send contact details (e.g. a question, complaint, greeting, or random text):
{ "is_contact_info": false, "name": null, "email": null, "city": null }

Examples of contact info (is_contact_info=true):
  "Anna Svensson anna@ex.com Stockholm"
  "hej mitt namn är Lars, lars@gmail.com, bor i malmö"
  "Erik Johansson\nerik.j@outlook.se\nGöteborg"
  "anna@test.se / Anna / Lund"

Examples of NOT contact info (is_contact_info=false):
  "Hej, när hör ni av er?"
  "Kan jag ändra tid?"
  "Ok tack"
  "Vad kostar det?"`;

  const body = JSON.stringify({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            const content = json.choices?.[0]?.message?.content;
            resolve(JSON.parse(content));
          } catch (e) {
            reject(new Error(`OpenAI parse error: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── POST /sms/send ────────────────────────────────────────────────────────────
// Body: { tenant_id, case_id, to, message? }
// If message omitted, reads sms_post_call_message from tenant_settings.
router.post("/send", async (req, res) => {
  const { tenant_id, case_id, to, message: bodyMessage } = req.body || {};
  if (!tenant_id || !to) {
    return res.status(400).json({ error: "tenant_id and to required" });
  }

  try {
    const config  = await getTenantSmsConfig(tenant_id);
    const message = bodyMessage || config.postCallMessage;
    const segments = countSegments(message);
    const cost_customer_sek = parseFloat((COST_PER_SEGMENT_SEK * segments).toFixed(2));

    const elkRes = await sendElkSMS(to, message);
    const cost_elk_ore = Math.round((elkRes.cost || 0) / 100);

    const now = FieldValue.serverTimestamp();
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
    );

    const session = {
      tenant_id,
      case_id:            case_id || null,
      from:               ELK_FROM_NUMBER,
      to,
      message_sent:       message,
      segments,
      elk_message_id:     elkRes.id,
      status:             "pending",
      fallback_sent:      false,
      cost_elk_ore,
      cost_customer_sek,
      sent_at:            now,
      expires_at:         expiresAt,
      createdAt:          now,
      updatedAt:          now,
    };

    const ref = await getDb().collection(SMS_SESSIONS).add(session);

    console.log(JSON.stringify({
      event: "sms_sent", tenant_id, to,
      elk_id: elkRes.id, segments, cost_elk_ore, cost_customer_sek,
    }));

    res.status(201).json({ id: ref.id, elk_message_id: elkRes.id, segments, cost_elk_ore, cost_customer_sek });
  } catch (err) {
    console.error(JSON.stringify({ event: "sms_send_failed", tenant_id, to, error: err.message }));
    alertOnError("sms_send_failed", { tenant_id, case_id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sms/inbound ─────────────────────────────────────────────────────────
// 46elks webhook. Form-encoded: from, to, message, id, created.
// No auth — 46elks POSTs here; route is intentionally unauthenticated.
router.post("/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  // ACK immediately — 46elks retries if we don't respond fast
  // Empty body: 46elks only sends an SMS reply if the response body is non-empty.
  res.status(200).end();

  const { from: customerPhone, to: elkNumber, message, id: elkId } = req.body || {};
  if (!customerPhone || !elkNumber || !message) return;

  console.log(JSON.stringify({ event: "sms_inbound", from: customerPhone, to: elkNumber, elk_id: elkId }));

  // ── Find pending session ──────────────────────────────────────────────────
  const snap = await getDb()
    .collection(SMS_SESSIONS)
    .where("to", "==", customerPhone)
    .where("from", "==", elkNumber)
    .where("status", "==", "pending")
    .orderBy("sent_at", "desc")
    .limit(1)
    .get()
    .catch((err) => {
      console.error(JSON.stringify({ event: "sms_session_lookup_failed", error: err.message }));
      return null;
    });

  if (!snap || snap.empty) {
    console.log(JSON.stringify({ event: "sms_inbound_no_session", from: customerPhone }));
    return;
  }

  const sessionDoc = snap.docs[0];
  const session = sessionDoc.data();

  // Check not expired
  const expiresAt = session.expires_at?.toDate?.() ?? new Date(session.expires_at);
  if (expiresAt < new Date()) {
    await sessionDoc.ref.set({ status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  // ── AI parse ──────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = await parseContactInfo(message);
  } catch (err) {
    console.error(JSON.stringify({ event: "sms_parse_failed", error: err.message }));
    return;
  }

  console.log(JSON.stringify({ event: "sms_parsed", is_contact_info: parsed.is_contact_info, parsed }));

  // ── Branch: contact info vs. other message ────────────────────────────────
  if (!parsed.is_contact_info) {
    // Send one static fallback — but only if we haven't already (no AI conversation)
    if (!session.fallback_sent) {
      try {
        const config = await getTenantSmsConfig(session.tenant_id);

        // Check whether we already have this customer's email on file
        let alreadyHaveEmail = false;
        if (session.case_id) {
          const caseSnap = await getDb().collection(CASES).doc(session.case_id).get();
          alreadyHaveEmail = !!(caseSnap.exists && caseSnap.data()?.email);
        }

        const fallbackText = alreadyHaveEmail
          ? config.fallbackAlreadyProcessed
          : config.fallbackNeedsInfo;

        await sendElkSMS(customerPhone, fallbackText);
        await sessionDoc.ref.set({
          fallback_sent:      true,
          fallback_type:      alreadyHaveEmail ? "already_processed" : "needs_info",
          updatedAt:          FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(JSON.stringify({
          event:      "sms_fallback_sent",
          tenant_id:  session.tenant_id,
          to:         customerPhone,
          type:       alreadyHaveEmail ? "already_processed" : "needs_info",
        }));

        // Notify admin + tenant when a lead sends an inquiry (not contact info)
        alertOnLeadInquiry({
          tenantId:                session.tenant_id,
          phone:                   customerPhone,
          message,
          tenantNotificationEmail: config.contactEmail || null,
        });
      } catch (err) {
        console.error(JSON.stringify({ event: "sms_fallback_failed", error: err.message }));
      }
    }
    // Session stays "pending" so customer can still reply with their details
    return;
  }

  // ── Contact info received — update case ───────────────────────────────────
  await sessionDoc.ref.set({
    status:        "replied",
    message_reply: message,
    reply_parsed:  parsed,
    replied_at:    FieldValue.serverTimestamp(),
    updatedAt:     FieldValue.serverTimestamp(),
  }, { merge: true });

  if (session.case_id && (parsed.name || parsed.email || parsed.city)) {
    try {
      await getDb().collection(CASES).doc(session.case_id).set({
        ...(parsed.name  && { name: parsed.name }),
        ...(parsed.email && { email: parsed.email }),
        ...(parsed.city  && { city: parsed.city }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log(JSON.stringify({
        event:     "sms_case_updated",
        tenant_id: session.tenant_id,
        case_id:   session.case_id,
        name:      parsed.name,
        email:     parsed.email,
        city:      parsed.city,
      }));

      // Trigger Pipefy sync — syncPipefyForCase() short-circuits if name/email
      // still missing. Idempotent — safe to call after every reply.
      syncPipefyForCase(session.case_id).catch((err) =>
        console.error(JSON.stringify({
          event: "sms_pipefy_trigger_failed",
          case_id: session.case_id,
          error: err.message,
        }))
      );
    } catch (err) {
      console.error(JSON.stringify({ event: "sms_case_update_failed", case_id: session.case_id, error: err.message }));
    }
  }
});

// ── POST /sms/reminders/run ───────────────────────────────────────────────────
// Called by Cloud Scheduler every 2 hours during business hours.
// Finds active cases needing a reminder SMS and sends it.
//
// Rules:
//   - case.tenant_id matches body.tenant_id (default: enkla-juridik)
//   - case.active === true
//   - case.email is missing/empty
//   - case.reminder_count < MAX_REMINDERS (2)
//   - last contact (last_reminder OR last_call_at) is > MIN_HOURS (24) ago
//   - case.phone does NOT start with +4610 (landlines, can't receive SMS)
//   - hard cap MAX_PER_RUN (30) per invocation
router.post("/reminders/run", async (req, res) => {
  const tenant_id = req.body?.tenant_id || "enkla-juridik";
  const MAX_REMINDERS    = 2;
  const MIN_HOURS        = 24;
  const MAX_PER_RUN      = 30;

  try {
    const config = await getTenantSmsConfig(tenant_id);

    // Pull a wider candidate set, then filter in memory (Firestore can't OR multiple fields)
    const snap = await getDb()
      .collection(CASES)
      .where("tenant_id", "==", tenant_id)
      .where("active", "==", true)
      .limit(200)
      .get();

    const now = new Date();
    const candidates = [];

    for (const doc of snap.docs) {
      const c = doc.data();
      if (c.email && String(c.email).trim()) continue;                    // already complete
      if ((c.reminder_count || 0) >= MAX_REMINDERS) continue;             // exhausted
      const phone = String(c.phone || "").replace(/\s/g, "");
      if (phone.startsWith("+4610") || phone.startsWith("4610") || phone.startsWith("010")) continue; // landline

      const lastTs = c.last_reminder?.toDate?.() ?? c.last_call_at?.toDate?.() ?? null;
      if (lastTs) {
        const hoursAgo = (now - lastTs) / (1000 * 60 * 60);
        if (hoursAgo < MIN_HOURS) continue;
      }

      candidates.push({ id: doc.id, ...c, phone });
      if (candidates.length >= MAX_PER_RUN) break;
    }

    const sent = [];
    const failed = [];

    for (const c of candidates) {
      try {
        // reminder_count 0 → this is reminder 1; reminder_count 1 → this is reminder 2
        const reminderText = (c.reminder_count || 0) === 0
          ? config.reminder1Message
          : config.reminder2Message;
        const segments = countSegments(reminderText);
        const elkRes = await sendElkSMS(c.phone, reminderText);

        const expiresAt = Timestamp.fromDate(
          new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
        );

        await getDb().collection(SMS_SESSIONS).add({
          tenant_id,
          case_id:           c.id,
          from:              ELK_FROM_NUMBER,
          to:                c.phone,
          message_sent:      reminderText,
          segments,
          elk_message_id:    elkRes.id,
          status:            "pending",
          fallback_sent:     false,
          is_reminder:       true,
          cost_elk_ore:      Math.round((elkRes.cost || 0) / 100),
          cost_customer_sek: parseFloat((COST_PER_SEGMENT_SEK * segments).toFixed(2)),
          sent_at:           FieldValue.serverTimestamp(),
          expires_at:        expiresAt,
          createdAt:         FieldValue.serverTimestamp(),
          updatedAt:         FieldValue.serverTimestamp(),
        });

        await getDb().collection(CASES).doc(c.id).set({
          reminder_count:    (c.reminder_count || 0) + 1,
          last_reminder:     FieldValue.serverTimestamp(),
          updatedAt:         FieldValue.serverTimestamp(),
        }, { merge: true });

        sent.push({ case_id: c.id, phone: c.phone });
      } catch (err) {
        failed.push({ case_id: c.id, error: err.message });
        console.error(JSON.stringify({ event: "reminder_send_failed", case_id: c.id, error: err.message }));
      }
    }

    console.log(JSON.stringify({
      event: "reminders_run",
      tenant_id,
      scanned: snap.size,
      candidates: candidates.length,
      sent: sent.length,
      failed: failed.length,
    }));

    res.json({ scanned: snap.size, candidates: candidates.length, sent, failed });
  } catch (err) {
    console.error(JSON.stringify({ event: "reminders_run_failed", error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── GET /sms ──────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { tenant_id, case_id, status, since, until, limit = "20" } = req.query;
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    let q = getDb().collection(SMS_SESSIONS).where("tenant_id", "==", tenant_id);
    if (case_id) q = q.where("case_id", "==", case_id);
    if (status)  q = q.where("status", "==", status);
    if (since)   q = q.where("sent_at", ">=", new Date(since));
    if (until)   q = q.where("sent_at", "<",  new Date(until));
    q = q.orderBy("sent_at", "desc").limit(Math.min(Number(limit) || 20, 1000));

    const snap = await q.get();
    const sessions = snap.docs.map((d) => ({ id: d.id, ...serializeTimestamps(d.data()) }));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message, hint: "May need a Firestore composite index" });
  }
});

// ── GET /sms/cost-preview ─────────────────────────────────────────────────────
// ?message=... → returns segments + cost so dashboard can preview before saving
router.get("/cost-preview", (req, res) => {
  const { message } = req.query;
  if (!message) return res.status(400).json({ error: "message required" });
  const segments = countSegments(message);
  res.json({
    segments,
    cost_customer_sek: parseFloat((COST_PER_SEGMENT_SEK * segments).toFixed(2)),
    cost_elk_ore_approx: segments * 52,
    length: message.length,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function serializeTimestamps(data) {
  const out = { ...data };
  for (const key of ["sent_at", "replied_at", "expires_at", "createdAt", "updatedAt"]) {
    if (out[key]?._seconds) out[key] = new Date(out[key]._seconds * 1000).toISOString();
  }
  return out;
}

module.exports = router;
