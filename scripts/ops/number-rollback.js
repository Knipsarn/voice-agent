/**
 * ops/number-rollback.js — Reverts a number from the shared app back to the
 * per-tenant app it was on before cutover. Reads previous_connection_id from
 * the Firestore assignment doc.
 *
 * Usage:
 *   node scripts/ops/number-rollback.js <e164> [--keep-doc]
 *
 * By default the Firestore assignment is also deleted (so telephony-service
 * stops claiming this number on any in-flight Telnyx delivery). Pass
 * --keep-doc to leave it in place.
 */

const c = require("./_client");
const httpMod = require(c.BASE_URL.startsWith("https") ? "https" : "http");

function del(path) {
  const url = new URL(path, c.BASE_URL);
  const headers = { "Content-Type": "application/json" };
  if (process.env.CONTROL_PLANE_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.CONTROL_PLANE_API_KEY}`;
  }
  return new Promise((resolve, reject) => {
    const req = httpMod.request(url, { method: "DELETE", headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

const e164 = process.argv[2];
const keepDoc = process.argv.includes("--keep-doc");

if (!e164) {
  console.error("Usage: node scripts/ops/number-rollback.js <e164> [--keep-doc]");
  process.exit(1);
}

const TELNYX_API_KEY = process.env.TELNYX_API_KEY?.trim();
if (!TELNYX_API_KEY) {
  console.error("[rollback] TELNYX_API_KEY not set in env or config/.env");
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
  if (!res.ok) throw new Error(`Telnyx ${method} ${path} → ${res.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  return parsed;
}

(async () => {
  console.log(`[rollback] target: ${e164}`);

  const docRes = await c.get(`/numbers/${encodeURIComponent(e164)}`);
  if (docRes.status >= 400) {
    console.error(`[rollback] No Firestore assignment for ${e164}. HTTP ${docRes.status}`);
    process.exit(1);
  }
  const doc = docRes.body;
  const numberId = doc.provider_number_id;
  const prevConn = doc.previous_connection_id;
  if (!numberId) { console.error(`[rollback] doc missing provider_number_id`); process.exit(1); }
  if (!prevConn) { console.error(`[rollback] doc missing previous_connection_id — nothing to roll back to`); process.exit(1); }
  console.log(`[rollback] previous connection: ${prevConn}`);

  await telnyx("PATCH", `/phone_numbers/${numberId}/voice`, { connection_id: prevConn });
  const verify = await telnyx("GET", `/phone_numbers/${numberId}`);
  const v = verify.data || {};
  console.log(`[rollback] Telnyx now: ${v.phone_number} → ${v.connection_name} (${v.connection_id})`);
  if (v.connection_id !== prevConn) {
    console.error(`[rollback] WARNING: Telnyx still reports unexpected connection_id`);
    process.exit(2);
  }

  if (!keepDoc) {
    const delRes = await del(`/numbers/${encodeURIComponent(e164)}`);
    if (delRes.status >= 400) {
      console.error(`[rollback] Failed to delete Firestore doc: HTTP ${delRes.status}`);
      console.error(JSON.stringify(delRes.body, null, 2));
      process.exit(1);
    }
    console.log(`[rollback] Firestore doc deleted.`);
  } else {
    console.log(`[rollback] Firestore doc kept (--keep-doc).`);
  }

  console.log(`[rollback] DONE. ${e164} is back on the old per-tenant app.`);
})().catch((err) => {
  console.error(`[rollback] ${err.message}`);
  process.exit(1);
});
