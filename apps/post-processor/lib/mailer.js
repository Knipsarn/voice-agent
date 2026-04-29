"use strict";
/**
 * lib/mailer.js
 *
 * Sends post-call summary emails via Postmark.
 * Reads recipient from Firestore tenant_settings.<tenantId>.summary_email.
 * Also sends urgent-call alerts to notification_email if urgency is "urgent".
 *
 * Requires env: POSTMARK_API_KEY, POSTMARK_FROM (e.g. "agent@yourdomain.se")
 */

const { Firestore } = require("@google-cloud/firestore");

const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const FROM_EMAIL = process.env.POSTMARK_FROM || "agent@voice.snmintegrations.se";
const SETTINGS_COLLECTION = "tenant_settings";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

async function getTenantSettings(tenantId) {
  const snap = await getDb().collection(SETTINGS_COLLECTION).doc(tenantId).get();
  return snap.exists ? snap.data() : {};
}

function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Stockholm" });
}

function buildHtml(call, summary) {
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const urgentBanner = summary?.urgency === "urgent"
    ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:12px 16px;margin-bottom:20px;color:#991b1b;font-weight:600;">⚠️ Brådskande — kräver uppföljning</div>`
    : "";

  const transcriptHtml = transcript.length === 0
    ? `<p style="color:#6b7280;font-size:14px;">Inget transkript tillgängligt.</p>`
    : transcript.map(t => `
        <div style="margin-bottom:10px;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${t.role === "agent" ? "#5b5bd6" : "#6b7280"};">${t.role === "agent" ? "Agent" : "Kund"}</span>
          <p style="margin:2px 0 0;font-size:14px;color:#111827;line-height:1.6;">${escHtml(t.message || t.text || "")}</p>
        </div>`).join("");

  const suggestedAction = summary?.suggested_action
    ? `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:12px 16px;margin-top:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5b5bd6;margin-bottom:4px;">Föreslagen åtgärd</div>
        <div style="font-size:14px;color:#111827;">${escHtml(summary.suggested_action)}</div>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">

    <!-- Header -->
    <div style="background:#0a0a0a;padding:20px 28px;display:flex;align-items:center;gap:10px;">
      <div style="width:28px;height:28px;background:#5b5bd6;border-radius:6px;display:flex;align-items:center;justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
      </div>
      <span style="color:#fff;font-size:15px;font-weight:600;letter-spacing:-.02em;">Voice Platform</span>
    </div>

    <div style="padding:28px;">
      ${urgentBanner}

      <!-- Meta -->
      <p style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;margin:0 0 6px;">Nytt samtal</p>
      <h1 style="font-size:24px;font-weight:700;color:#0a0a0a;margin:0 0 4px;letter-spacing:-.03em;">${escHtml(call.from_number || "Okänt nummer")}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">${formatTs(call.initiated_at)} · ${formatDuration(call.duration_ms)}</p>

      ${summary ? `
      <!-- Summary -->
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:10px;">Sammanfattning</div>
        <p style="font-size:15px;color:#111827;line-height:1.7;margin:0 0 16px;">${escHtml(summary.summary || "")}</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid #f3f4f6;padding-top:14px;">
          ${kv("Avsikt", summary.intent)}
          ${kv("Resultat", summary.outcome)}
          ${kv("Uppföljning", summary.requires_followup ? "Behövs" : "Ej nödvändig")}
        </div>
        ${suggestedAction}
      </div>
      ` : ""}

      <!-- Transcript -->
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:20px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:14px;">Transkript</div>
        ${transcriptHtml}
      </div>
    </div>

    <div style="border-top:1px solid #e5e7eb;padding:16px 28px;text-align:center;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Voice Platform · Automatiskt genererat</p>
    </div>
  </div>
</body>
</html>`;
}

function kv(label, value) {
  return `<div><div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${label}</div><div style="font-size:13px;color:#374151;margin-top:2px;">${escHtml(String(value || "—"))}</div></div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendCallSummaryEmail(call, summary) {
  if (!POSTMARK_API_KEY) return { skipped: "no POSTMARK_API_KEY" };

  const settings = await getTenantSettings(call.tenant_id);
  const toEmail = settings.summary_email;
  const mode = settings.summary_email_mode || "per_call";

  if (!toEmail) return { skipped: "no summary_email configured" };
  if (mode === "off") return { skipped: "summary_email_mode is off" };

  const isUrgent = summary?.urgency === "urgent";
  const caller = call.from_number || "Okänt nummer";
  const subject = isUrgent
    ? `⚠️ Brådskande samtal – ${caller}`
    : `Nytt samtal – ${caller}`;

  const html = buildHtml(call, summary);
  const text = buildText(call, summary);

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_API_KEY,
    },
    body: JSON.stringify({
      From: FROM_EMAIL,
      To: toEmail,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      MessageStream: "outbound",
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Postmark error: ${data.Message || JSON.stringify(data)}`);

  // Send urgent alert to notification_email if different
  if (isUrgent && settings.notification_email && settings.notification_email !== toEmail) {
    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_API_KEY,
      },
      body: JSON.stringify({
        From: FROM_EMAIL,
        To: settings.notification_email,
        Subject: `⚠️ Brådskande samtal – ${caller} (${call.tenant_id})`,
        HtmlBody: html,
        TextBody: text,
        MessageStream: "outbound",
      }),
    }).catch(() => {}); // best-effort
  }

  return { sent: true, to: toEmail, message_id: data.MessageID };
}

function buildText(call, summary) {
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const lines = [
    `NYTT SAMTAL — ${call.from_number || "Okänt"}`,
    `Tid: ${formatTs(call.initiated_at)} · Längd: ${formatDuration(call.duration_ms)}`,
    "",
  ];
  if (summary) {
    lines.push("SAMMANFATTNING", summary.summary || "", "");
    if (summary.suggested_action) lines.push("ÅTGÄRD", summary.suggested_action, "");
  }
  if (transcript.length > 0) {
    lines.push("TRANSKRIPT");
    transcript.forEach(t => lines.push(`${t.role === "agent" ? "Agent" : "Kund"}: ${t.message || t.text || ""}`));
  }
  return lines.join("\n");
}

module.exports = { sendCallSummaryEmail };
