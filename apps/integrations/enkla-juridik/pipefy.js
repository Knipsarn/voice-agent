"use strict";
/**
 * integrations/enkla-juridik/pipefy.js
 *
 * Pipefy GraphQL client for enkla-juridik.
 * Pipe ID: 1035948
 *
 * Flow per call:
 *   1. If case has pipefy_card_id → updateFieldsValues on existing card
 *   2. Otherwise → createCard in the intake pipe phase, store returned card ID
 *
 * Field IDs are fetched once from the Pipefy pipe definition and cached.
 * Field labels used for matching:
 *   Namn, Telefonnummer, Email, Ort, Kundens initiala meddelande, Ärendetyp
 *
 * Token: set PIPEFY_TOKEN env var (Secret Manager: PIPEFY_TOKEN_ENKLA_JURIDIK).
 * Fallback to the hardcoded token below if env var is absent.
 */

const https = require("https");

const PIPE_ID = "1035948";
const PIPEFY_API = "api.pipefy.com";

function getToken() {
  return (
    process.env.PIPEFY_TOKEN_ENKLA_JURIDIK ||
    process.env.PIPEFY_TOKEN ||
    "eyJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJQaXBlZnkiLCJpYXQiOjE3NjUzNzI1MDcsImp0aSI6ImI0MTI3ZjQxLTEzM2YtNGI2OS1hZjM1LTIzNjQ5NTEzYzAzZSIsInN1YiI6ODgzMTUxLCJ1c2VyIjp7ImlkIjo4ODMxNTEsImVtYWlsIjoibmllbHMuZ3JvZW5ld2VnZW5AZW5rbGFqdXJpZGlrLnNlIn0sInVzZXJfdHlwZSI6ImF1dGhlbnRpY2F0ZWQifQ.5GRTkMOCvgpf7Ylko_XKNVHsDAXrOIEJXT_iSfdTsj6ZTzzdrb6OPgkVSAFgGVL2VKqK57UMMxSdiew5PFYYtA"
  );
}

// In-memory cache: { fieldMap: {label->id}, firstPhaseId }
let pipeCache = null;

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(
      {
        hostname: PIPEFY_API,
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
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
            reject(new Error(`Pipefy parse error: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getPipeCache() {
  if (pipeCache) return pipeCache;

  const res = await gql(`
    query {
      pipe(id: "${PIPE_ID}") {
        start_form_fields { id label }
        phases { id name cards_count }
      }
    }
  `);

  const pipe = res.data.pipe;
  const fieldMap = {};
  for (const f of pipe.start_form_fields) {
    fieldMap[f.label] = f.id;
  }

  // First phase = intake / the phase where new cards land
  const firstPhaseId = pipe.phases[0]?.id;

  pipeCache = { fieldMap, firstPhaseId };
  return pipeCache;
}

function buildFieldAttributes(fieldMap, { name, phone, email, city, summary, category }) {
  const pairs = [
    ["Namn", name],
    ["Telefonnummer", phone],
    ["Email", email],
    ["Ort", city],
    ["Kundens initiala meddelande", summary],
    ["Ärendetyp", category],
  ];
  const attrs = [];
  for (const [label, value] of pairs) {
    if (value && fieldMap[label]) {
      attrs.push({ field_id: fieldMap[label], field_value: String(value) });
    }
  }
  return attrs;
}

async function createCard({ name, phone, email, city, summary, category }) {
  const { fieldMap, firstPhaseId } = await getPipeCache();
  const fields = buildFieldAttributes(fieldMap, { name, phone, email, city, summary, category });

  const res = await gql(`
    mutation CreateCard($input: CreateCardInput!) {
      createCard(input: $input) {
        card { id title }
      }
    }
  `, {
    input: {
      pipe_id: PIPE_ID,
      phase_id: firstPhaseId,
      fields_attributes: fields,
    },
  });

  return res.data.createCard.card.id;
}

async function updateCard(cardId, { name, phone, email, city, summary, category }) {
  const { fieldMap } = await getPipeCache();
  const fields = buildFieldAttributes(fieldMap, { name, phone, email, city, summary, category });
  const values = fields.map((f) => ({ fieldId: f.field_id, value: f.field_value }));

  await gql(`
    mutation UpdateFields($input: UpdateFieldsValuesInput!) {
      updateFieldsValues(input: $input) {
        clientMutationId
      }
    }
  `, {
    input: {
      nodeId: cardId,
      values,
    },
  });
}

/**
 * Upsert a Pipefy card for this case.
 * @param {string|null} existingCardId  - pipefy_card_id from Firestore case (null = create)
 * @param {object} fields               - { name, phone, email, city, summary, category }
 * @returns {string} cardId             - the Pipefy card ID (new or existing)
 */
async function syncCase(existingCardId, fields) {
  if (existingCardId) {
    await updateCard(existingCardId, fields);
    return existingCardId;
  } else {
    return createCard(fields);
  }
}

module.exports = { syncCase };
