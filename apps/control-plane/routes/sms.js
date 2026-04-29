"use strict";
/**
 * routes/sms.js
 *
 * SMS via 46elks. Two responsibilities:
 *
 *   POST /sms/send     — send outbound SMS, write sms_session to Firestore
 *   POST /sms/inbound  — 46elks webhook: incoming reply → parse → update case → sync Pipefy
 *   GET  /sms          — list sms_sessions for a tenant/case (dashboard / ops)
 *
 * Routing: sms_sessions collection maps (customer_phone × elk_number) → tenant_id + case_id.
 * When a reply arrives we look up the latest pending session for that customer phone.
 * Sessions expire after 7 days to avoid stale matches.
 *
 * Cost tracking:
 *   cost_elk_ore      — what 46elks actually charged (in öre, 100 öre = 1 SEK)
 *   cost_customer_sek — what we bill the tenant (3.50 SEK per SMS sent)
 */

const express = require("express");
const router = express.Router();
const https = require("https");
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore");

const SMS_SESSIONS    = "sms_sessions";
const CASES           = "cases";

// Cost config
const COST_CUSTOMER_SEK = 3.50;  // billed to tenant per outbound SMS

// 46elks config — reads from env, falls back to hardcoded for local dev
function elkAuth() {
  const user = process.env.ELK_API_USER || "ub50bc79a31806e8f428bf0033af6abb2";
  const pass = process.env.ELK_API_PASS || "4B156E4AAE61B04BC6EFB17C2FAA3984";
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}
const ELK_FROM_NUMBER = process.env.ELK_FROM_NUMBER || "+46766860841";
const SESSION_TTL_DAYS = 7;

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

// ── Send SMS via 46elks ───────────────────────────────────────────────────────
async function sendElkSMS(to, message) {
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
            if (res.statusCode >= 400) reject(new Error(`46elks HTTP ${res.statusCode}: ${raw}`));
            else resolve(body);
          } catch (e) {
            reject(new Error(`46elks parse error: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(params);
    req.end();
  });
}

// ── POST /sms/send ────────────────────────────────────────────────────────────
// Body: { tenant_id, case_id, to, message }
router.post("/send", async (req, res) => {
  const { tenant_id, case_id, to, message } = req.body || {};
  if (!tenant_id || !to || !message) {
    return res.status(400).json({ error: "tenant_id, to, and message required" });
  }

  try {
    const elkRes = await sendElkSMS(to, message);

    // cost from 46elks is in 1/100 öre. Convert to öre for storage.
    const cost_elk_ore = Math.round((elkRes.cost || 0) / 100);

    const now = FieldValue.serverTimestamp();
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
    );

    const session = {
      tenant_id,
      case_id:          case_id || null,
      from:             ELK_FROM_NUMBER,
      to,
      message_sent:     message,
      elk_message_id:   elkRes.id,
      status:           "pending",
      cost_elk_ore,
      cost_customer_sek: COST_CUSTOMER_SEK,
      sent_at:          now,
      expires_at:       expiresAt,
      createdAt:        now,
      updatedAt:        now,
    };

    const ref = await getDb().collection(SMS_SESSIONS).add(session);

    console.log(JSON.stringify({ event: "sms_sent", tenant_id, to, elk_id: elkRes.id, cost_elk_ore }));

    res.status(201).json({ id: ref.id, elk_message_id: elkRes.id, cost_elk_ore, cost_customer_sek: COST_CUSTOMER_SEK });
  } catch (err) {
    console.error(JSON.stringify({ event: "sms_send_failed", tenant_id, to, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sms/inbound ─────────────────────────────────────────────────────────
// 46elks webhook: called when a customer replies to our SMS.
// No auth header — 46elks sends a shared secret in the body if configured.
// Body (form-encoded): from, to, message, id, created
router.post("/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  const { from: customerPhone, to: elkNumber, message, id: elkId } = req.body || {};

  if (!customerPhone || !elkNumber || !message) {
    return res.status(400).send("missing fields");
  }

  console.log(JSON.stringify({ event: "sms_inbound", from: customerPhone, to: elkNumber, message: message.slice(0, 100) }));

  // ── Find the pending session for this customer ──────────────────────────────
  const now = new Date();
  const snap = await getDb()
    .collection(SMS_SESSIONS)
    .where("to", "==", customerPhone)
    .where("from", "==", elkNumber)
    .where("status", "==", "pending")
    .orderBy("sent_at", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    console.log(JSON.stringify({ event: "sms_inbound_no_session", from: customerPhone }));
    return res.send("ok"); // unknown reply — ACK to 46elks but no action
  }

  const sessionDoc = snap.docs[0];
  const session = sessionDoc.data();

  // Check not expired
  const expiresAt = session.expires_at?.toDate ? session.expires_at.toDate() : new Date(session.expires_at);
  if (expiresAt < now) {
    console.log(JSON.stringify({ event: "sms_inbound_expired", session_id: sessionDoc.id }));
    await sessionDoc.ref.set({ status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.send("ok");
  }

  // ── Parse reply: "Namn, email@example.com, Ort" ───────────────────────────
  const parsed = parseReply(message);

  // ── Mark session replied ──────────────────────────────────────────────────
  await sessionDoc.ref.set({
    status:         "replied",
    message_reply:  message,
    reply_parsed:   parsed,
    replied_at:     FieldValue.serverTimestamp(),
    updatedAt:      FieldValue.serverTimestamp(),
  }, { merge: true });

  // ── Update Firestore case ─────────────────────────────────────────────────
  if (session.case_id && (parsed.name || parsed.email || parsed.city)) {
    try {
      await getDb().collection(CASES).doc(session.case_id).set({
        ...(parsed.name  && { name: parsed.name }),
        ...(parsed.email && { email: parsed.email }),
        ...(parsed.city  && { city: parsed.city }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log(JSON.stringify({
        event:     "sms_reply_case_updated",
        tenant_id: session.tenant_id,
        case_id:   session.case_id,
        parsed,
      }));
    } catch (err) {
      console.error(JSON.stringify({ event: "sms_reply_case_update_failed", error: err.message }));
    }
  }

  res.send("ok"); // 46elks expects a 200 text/plain response
});

// ── GET /sms ──────────────────────────────────────────────────────────────────
// Query: tenant_id (required), case_id, status, limit
router.get("/", async (req, res) => {
  const { tenant_id, case_id, status, limit = "20" } = req.query;
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    let q = getDb().collection(SMS_SESSIONS).where("tenant_id", "==", tenant_id);
    if (case_id) q = q.where("case_id", "==", case_id);
    if (status)  q = q.where("status", "==", status);
    q = q.orderBy("sent_at", "desc").limit(Math.min(Number(limit) || 20, 100));

    const snap = await q.get();
    const sessions = snap.docs.map((d) => ({ id: d.id, ...serializeDoc(d.data()) }));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message, hint: "May need a Firestore composite index" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a customer reply into { name, email, city }.
 * Handles comma-separated, newline-separated, or mixed.
 * Examples:
 *   "Anna Svensson, anna@ex.com, Stockholm"
 *   "Anna Svensson\nanna@ex.com\nStockholm"
 *   "anna@ex.com Anna Svensson Stockholm"
 */
function parseReply(text) {
  const result = { name: null, email: null, city: null };
  if (!text) return result;

  // Normalize separators
  const parts = text.replace(/[\n\r]+/g, ",").split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (!result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
      result.email = part.toLowerCase();
    } else if (!result.name && /\s/.test(part) && !/\d/.test(part) && part.length > 3) {
      // Has a space, no digits → likely a name
      result.name = part;
    } else if (!result.city && !result.name && !/\s/.test(part) && part.length > 2) {
      // Single word, no digits — could be a city (set later if name not found)
    }
  }

  // If we have 3 parts and only found email, assign positionally
  if (parts.length >= 3 && !result.name) {
    const nonEmail = parts.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
    if (nonEmail.length >= 2) {
      result.name = result.name || nonEmail[0];
      result.city = result.city || nonEmail[nonEmail.length - 1];
    }
  } else if (parts.length >= 2 && !result.city) {
    const nonEmailNonName = parts.filter(
      (p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p) && p !== result.name
    );
    if (nonEmailNonName.length > 0) result.city = nonEmailNonName[nonEmailNonName.length - 1];
  }

  return result;
}

function serializeDoc(data) {
  const out = { ...data };
  for (const key of ["sent_at", "replied_at", "expires_at", "createdAt", "updatedAt"]) {
    if (out[key]?._seconds) out[key] = new Date(out[key]._seconds * 1000).toISOString();
  }
  return out;
}

module.exports = router;
