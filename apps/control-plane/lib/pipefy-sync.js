"use strict";
/**
 * lib/pipefy-sync.js
 *
 * Pipefy GraphQL sync for enkla-juridik. Pipe ID: 1035948.
 *
 * Exposes syncPipefyForCase(caseId) — reads case from Firestore, creates or
 * updates the Pipefy card, marks case as SENT + active=false on success.
 *
 * Called from:
 *   - POST /pipefy/sync (route)
 *   - POST /sms/inbound (after parsing complete contact info)
 *   - post-processor enkla-juridik integration (after call upsert)
 *
 * Field labels matched dynamically from the pipe definition; cached in memory.
 * If existing pipefy_card_id no longer exists in Pipefy → create a new card.
 */

const https = require("https");
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const PIPE_ID = "1035948";

function token() {
  return (
    process.env.PIPEFY_TOKEN_ENKLA_JURIDIK ||
    process.env.PIPEFY_TOKEN ||
    "eyJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJQaXBlZnkiLCJpYXQiOjE3NjUzNzI1MDcsImp0aSI6ImI0MTI3ZjQxLTEzM2YtNGI2OS1hZjM1LTIzNjQ5NTEzYzAzZSIsInN1YiI6ODgzMTUxLCJ1c2VyIjp7ImlkIjo4ODMxNTEsImVtYWlsIjoibmllbHMuZ3JvZW5ld2VnZW5AZW5rbGFqdXJpZGlrLnNlIn0sInVzZXJfdHlwZSI6ImF1dGhlbnRpY2F0ZWQifQ.5GRTkMOCvgpf7Ylko_XKNVHsDAXrOIEJXT_iSfdTsj6ZTzzdrb6OPgkVSAFgGVL2VKqK57UMMxSdiew5PFYYtA"
  );
}

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(
      {
        hostname: "api.pipefy.com",
        path: "/graphql",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.errors) reject(new Error(parsed.errors.map((e) => e.message).join("; ")));
            else resolve(parsed);
          } catch (e) {
            reject(new Error(`Pipefy parse: ${raw.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

let pipeCache = null;
async function getPipeFields() {
  if (pipeCache) return pipeCache;
  const res = await gql(`
    query { pipe(id: "${PIPE_ID}") {
      start_form_fields { id label }
      phases { id }
    }}
  `);
  const fieldMap = {};
  for (const f of res.data.pipe.start_form_fields) fieldMap[f.label] = f.id;
  pipeCache = { fieldMap, firstPhaseId: res.data.pipe.phases[0]?.id };
  return pipeCache;
}

async function cardExists(cardId) {
  if (!cardId) return false;
  try {
    const res = await gql(`query { card(id: "${cardId}") { id } }`);
    return !!res.data?.card?.id;
  } catch {
    return false;
  }
}

function buildAttrs(fieldMap, caseDoc) {
  const pairs = [
    ["Namn",                          caseDoc.name || "Okänd"],
    ["Telefonnummer",                 caseDoc.phone],
    ["Email",                         caseDoc.email],
    ["Ort",                           caseDoc.city],
    ["Kundens initiala meddelande",   caseDoc.summary],
  ];
  return pairs
    .filter(([label, val]) => val && fieldMap[label])
    .map(([label, val]) => ({ field_id: fieldMap[label], field_value: String(val) }));
}

/**
 * Sync a Firestore case to Pipefy. Idempotent.
 *
 * @param {string} caseId
 * @returns {object} { ok, case_id, pipefy_card_id, action: "created"|"updated", skipped? }
 */
async function syncPipefyForCase(caseId) {
  const ref = getDb().collection("cases").doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "case_not_found", case_id: caseId };

  const caseDoc = snap.data();

  // Gate: only sync when we have at minimum name+email (phone always known from call)
  if (!caseDoc.name || !caseDoc.email) {
    return { ok: false, skipped: "missing_contact_info", case_id: caseId };
  }

  const { fieldMap, firstPhaseId } = await getPipeFields();
  const title = caseDoc.name || "Nytt ärende";

  // Verify existing card still exists in Pipefy
  let cardId = caseDoc.pipefy_card_id || null;
  let action;
  if (cardId && !(await cardExists(cardId))) cardId = null;

  if (!cardId) {
    // CREATE
    const attrs = buildAttrs(fieldMap, caseDoc);
    const res = await gql(`
      mutation CreateCard($pipeId: ID!, $phaseId: ID!, $title: String!, $attrs: [FieldValueInput!]!) {
        createCard(input: { pipe_id: $pipeId, phase_id: $phaseId, title: $title, fields_attributes: $attrs }) {
          card { id }
        }
      }
    `, { pipeId: PIPE_ID, phaseId: firstPhaseId, title, attrs });
    cardId = res.data.createCard.card.id;
    action = "created";
  } else {
    // UPDATE — title + each field via updateFieldsValues
    await gql(`
      mutation UpdateTitle($id: ID!, $title: String!) {
        updateCard(input: { id: $id, title: $title }) { card { id } }
      }
    `, { id: cardId, title });

    const values = buildAttrs(fieldMap, caseDoc).map((a) => ({
      fieldId: a.field_id,
      value: a.field_value,
    }));
    if (values.length) {
      await gql(`
        mutation UpdateFields($nodeId: ID!, $values: [NodeFieldValueInput!]!) {
          updateFieldsValues(input: { nodeId: $nodeId, values: $values }) { success }
        }
      `, { nodeId: cardId, values });
    }
    action = "updated";
  }

  // Mark case as synced — status=SENT, active=false
  await ref.set({
    pipefy_card_id:    cardId,
    status:            "SENT",
    active:            false,
    pipefy_synced_at:  FieldValue.serverTimestamp(),
    updatedAt:         FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(JSON.stringify({ event: "pipefy_synced", case_id: caseId, pipefy_card_id: cardId, action }));

  return { ok: true, case_id: caseId, pipefy_card_id: cardId, action };
}

/**
 * Partial/auto sync — same as syncPipefyForCase but no name+email gate.
 * Used by the 12-hour auto-sync scheduler job.
 *
 * Status logic:
 *   - email present  → status=SENT,        active=false  (fully converted)
 *   - email missing  → status=WAITING_SMS,  active=true   (still collecting info)
 *
 * Also writes pipefy_auto_synced_at timestamp on the Firestore case.
 *
 * @param {string} caseId
 * @returns {object} { ok, case_id, pipefy_card_id, action: "created"|"updated", skipped? }
 */
async function syncPipefyPartial(caseId) {
  const ref = getDb().collection("cases").doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "case_not_found", case_id: caseId };

  const caseDoc = snap.data();

  // Require at minimum a phone number (always present from call)
  if (!caseDoc.phone) {
    return { ok: false, skipped: "missing_phone", case_id: caseId };
  }

  const { fieldMap, firstPhaseId } = await getPipeFields();
  const title = caseDoc.name || caseDoc.phone || "Nytt ärende";

  // Verify existing card still exists in Pipefy
  let cardId = caseDoc.pipefy_card_id || null;
  let action;
  if (cardId && !(await cardExists(cardId))) cardId = null;

  if (!cardId) {
    // CREATE
    const attrs = buildAttrs(fieldMap, caseDoc);
    const res = await gql(`
      mutation CreateCard($pipeId: ID!, $phaseId: ID!, $title: String!, $attrs: [FieldValueInput!]!) {
        createCard(input: { pipe_id: $pipeId, phase_id: $phaseId, title: $title, fields_attributes: $attrs }) {
          card { id }
        }
      }
    `, { pipeId: PIPE_ID, phaseId: firstPhaseId, title, attrs });
    cardId = res.data.createCard.card.id;
    action = "created";
  } else {
    // UPDATE — title + each field via updateFieldsValues
    await gql(`
      mutation UpdateTitle($id: ID!, $title: String!) {
        updateCard(input: { id: $id, title: $title }) { card { id } }
      }
    `, { id: cardId, title });

    const values = buildAttrs(fieldMap, caseDoc).map((a) => ({
      fieldId: a.field_id,
      value: a.field_value,
    }));
    if (values.length) {
      await gql(`
        mutation UpdateFields($nodeId: ID!, $values: [NodeFieldValueInput!]!) {
          updateFieldsValues(input: { nodeId: $nodeId, values: $values }) { success }
        }
      `, { nodeId: cardId, values });
    }
    action = "updated";
  }

  // Status depends on whether we have an email
  const hasEmail = !!caseDoc.email;
  const firestoreUpdate = {
    pipefy_card_id:        cardId,
    status:                hasEmail ? "SENT" : "WAITING_SMS",
    active:                !hasEmail,
    pipefy_synced_at:      FieldValue.serverTimestamp(),
    pipefy_auto_synced_at: FieldValue.serverTimestamp(),
    updatedAt:             FieldValue.serverTimestamp(),
  };
  await ref.set(firestoreUpdate, { merge: true });

  console.log(JSON.stringify({
    event:          "pipefy_auto_synced",
    case_id:        caseId,
    pipefy_card_id: cardId,
    action,
    has_email:      hasEmail,
    status:         firestoreUpdate.status,
  }));

  return { ok: true, case_id: caseId, pipefy_card_id: cardId, action, status: firestoreUpdate.status };
}

module.exports = { syncPipefyForCase, syncPipefyPartial };
