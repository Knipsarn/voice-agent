/**
 * ops/number-cutover.js — Move a Telnyx number from its old per-tenant Call
 * Control App to the shared voice-platform-shared app, and write the
 * phone_numbers Firestore record.
 *
 * After this completes, the next inbound call to <e164> goes through
 * telephony-service instead of n8n.
 *
 * Usage:
 *   node scripts/ops/number-cutover.js <e164> --tenant=<tenantId> [--dry-run]
 *
 * Examples:
 *   node scripts/ops/number-cutover.js +46105201311 --tenant=alvsjo-tandvard --dry-run
 *   node scripts/ops/number-cutover.js +46105201311 --tenant=alvsjo-tandvard
 *
 * Requires in config/.env:
 *   TELNYX_API_KEY                  (also used by telephony-service / voice-bridge)
 *   CONTROL_PLANE_BASE_URL          (Cloud Run URL or http://localhost:4000)
 *   CONTROL_PLANE_API_KEY
 *
 * Optional:
 *   TELNYX_SHARED_APP_ID            (defaults to 2946878804032751101)
 */

const { post, handleError } = require("./_client");

const SHARED_APP_ID = process.env.TELNYX_SHARED_APP_ID || "2946878804032751101";
const TELNYX_API_BASE = "https://api.telnyx.com/v2";

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const e164 = process.argv[2];
const tenantId = arg("tenant");
const dryRun = process.argv.includes("--dry-run");

if (!e164 || !tenantId) {
  console.error("Usage: node scripts/ops/number-cutover.js <e164> --tenant=<tenantId> [--dry-run]");
  process.exit(1);
}

const TELNYX_API_KEY = process.env.TELNYX_API_KEY?.trim();
if (!TELNYX_API_KEY) {
  console.error("[cutover] TELNYX_API_KEY not set in env or config/.env");
  process.exit(1);
}

async function telnyx(method, path, body) {
  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    throw new Error(`Telnyx ${method} ${path} → ${res.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function findNumber(e164) {
  // Telnyx phone_numbers list filter accepts a phone_number query param
  const search = await telnyx("GET", `/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`);
  const data = search.data || [];
  if (data.length === 0) throw new Error(`Number ${e164} not found in Telnyx account`);
  if (data.length > 1) throw new Error(`Multiple Telnyx records for ${e164} — refusing to guess`);
  return data[0];
}

(async () => {
  console.log(`[cutover] target: ${e164} → tenant=${tenantId}${dryRun ? " (DRY RUN)" : ""}`);

  // 1) Look up the number in Telnyx
  const number = await findNumber(e164);
  console.log(`[cutover] Telnyx record:`);
  console.log(`           id:                ${number.id}`);
  console.log(`           phone_number:      ${number.phone_number}`);
  console.log(`           current conn_id:   ${number.connection_id} (${number.connection_name})`);
  console.log(`           status:            ${number.status}`);

  if (number.connection_id === SHARED_APP_ID) {
    console.log(`[cutover] Number is already on the shared app. Will only refresh the Firestore record.`);
  }

  if (dryRun) {
    console.log(`[cutover] DRY RUN — would:`);
    console.log(`           1. POST /numbers/${e164}/assign with tenant=${tenantId}, prev_conn=${number.connection_id}`);
    console.log(`           2. PATCH Telnyx /v2/phone_numbers/${number.id}/voice connection_id=${SHARED_APP_ID}`);
    return;
  }

  // 2) Write the Firestore assignment doc FIRST. If this fails, no Telnyx change happens.
  const assignRes = await post(`/numbers/${encodeURIComponent(e164)}/assign`, {
    tenant_id: tenantId,
    provider_number_id: number.id,
    previous_connection_id: number.connection_id,
  });
  if (assignRes.status >= 400) {
    console.error(`[cutover] Firestore assign failed: HTTP ${assignRes.status}`);
    console.error(JSON.stringify(assignRes.body, null, 2));
    process.exit(1);
  }
  console.log(`[cutover] Firestore record written.`);

  // 3) Re-attach the number in Telnyx (this is the cutover moment)
  await telnyx("PATCH", `/phone_numbers/${number.id}/voice`, { connection_id: SHARED_APP_ID });
  console.log(`[cutover] Telnyx number reattached to shared app ${SHARED_APP_ID}.`);

  // 4) Verify
  const verify = await telnyx("GET", `/phone_numbers/${number.id}`);
  const v = verify.data || {};
  console.log(`[cutover] Verify: ${v.phone_number} → ${v.connection_name} (${v.connection_id})`);

  if (v.connection_id !== SHARED_APP_ID) {
    console.error(`[cutover] WARNING: Telnyx still reports old connection_id. Check the dashboard.`);
    process.exit(2);
  }

  console.log(`[cutover] DONE. Next call to ${e164} will route via telephony-service.`);
  console.log(`[cutover] Rollback: node scripts/ops/number-rollback.js ${e164}`);
})().catch((err) => {
  console.error(`[cutover] ${err.message}`);
  process.exit(1);
});
