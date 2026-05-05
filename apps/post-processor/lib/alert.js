"use strict";
/**
 * lib/alert.js
 *
 * Sends admin alert emails via Resend when actionable errors occur.
 * Non-blocking — errors are logged but never thrown.
 *
 * Env:
 *   RESEND_API_KEY           — required to send
 *   ALERT_FROM_EMAIL         — defaults to noreply@snmintegrations.se
 *   ADMIN_NOTIFICATION_EMAIL — defaults to nils.wahlin@snmintegrations.se
 */

const FROM    = process.env.ALERT_FROM_EMAIL          || "Voice Platform <noreply@snmintegrations.se>";
const ADMIN   = process.env.ADMIN_NOTIFICATION_EMAIL   || "nils.wahlin@snmintegrations.se";

async function sendAlert({ subject, text, extraTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(JSON.stringify({ event: "alert_skipped", reason: "no RESEND_API_KEY", subject }));
    return;
  }

  const to = extraTo ? [ADMIN, extraTo].filter(Boolean) : [ADMIN];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(JSON.stringify({ event: "alert_send_failed", subject, status: res.status, body }));
    } else {
      console.log(JSON.stringify({ event: "alert_sent", subject, to }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "alert_send_error", subject, error: err.message }));
  }
}

/**
 * Alert admin when an integration error occurs that may need attention.
 * @param {string} event   — e.g. "integration_sms_failed"
 * @param {object} fields  — { tenant_id, case_id, error, ... }
 */
async function alertOnError(event, fields = {}) {
  const { tenant_id, case_id, error } = fields;
  const subject = `[Voice Platform] Error: ${event}`;
  const text = [
    `Event: ${event}`,
    tenant_id ? `Tenant: ${tenant_id}` : null,
    case_id   ? `Case:   ${case_id}`   : null,
    error     ? `Error:  ${error}`      : null,
    "",
    "Check Cloud Logging / admin incidents dashboard for details.",
    `https://console.cloud.google.com/run?project=ldk-clean`,
  ].filter((l) => l !== null).join("\n");

  await sendAlert({ subject, text });
}

/**
 * Alert when a lead sends an SMS inquiry (not contact info) — business event.
 * Notified to both admin and the tenant's notification_email if set.
 */
async function alertOnLeadInquiry({ tenantId, phone, message, tenantNotificationEmail }) {
  const subject = `[Enkla Juridik] Lead sent inquiry via SMS`;
  const text = [
    `A lead replied to our SMS but did not send contact info.`,
    "",
    `Phone:   ${phone}`,
    `Message: ${message}`,
    `Tenant:  ${tenantId}`,
    "",
    "The static fallback reply has been sent. No action needed unless you want to follow up manually.",
  ].join("\n");

  await sendAlert({ subject, text, extraTo: tenantNotificationEmail || null });
}

module.exports = { alertOnError, alertOnLeadInquiry };
