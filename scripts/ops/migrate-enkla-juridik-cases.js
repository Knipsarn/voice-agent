#!/usr/bin/env node
/**
 * migrate-enkla-juridik-cases.js
 *
 * One-time import of the n8n DataTable (Enkla_juridik) into Firestore /cases.
 * Reads scripts/data/enkla-juridik-cases.csv and POSTs each row to control-plane.
 *
 * Usage:
 *   node scripts/ops/migrate-enkla-juridik-cases.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { post, BASE_URL } = require("./_client");

const DRY_RUN = process.argv.includes("--dry-run");
const CSV_PATH = path.join(__dirname, "../data/enkla-juridik-cases.csv");
const TENANT_ID = "enkla-juridik";

// ── CSV parser (handles quoted multiline fields) ──────────────────────────────
function parseCSV(raw) {
  const rows = [];
  let i = 0;
  const n = raw.length;

  function readField() {
    if (i >= n) return "";
    if (raw[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let val = "";
      while (i < n) {
        if (raw[i] === '"' && raw[i + 1] === '"') {
          val += '"'; i += 2;
        } else if (raw[i] === '"') {
          i++; break; // closing quote
        } else {
          val += raw[i++];
        }
      }
      return val;
    } else {
      let val = "";
      while (i < n && raw[i] !== "," && raw[i] !== "\n" && raw[i] !== "\r") {
        val += raw[i++];
      }
      return val;
    }
  }

  function readRow() {
    const row = [];
    while (i < n && raw[i] !== "\n" && !(raw[i] === "\r" && raw[i + 1] === "\n")) {
      row.push(readField());
      if (i < n && raw[i] === ",") i++; // skip comma
    }
    // skip line ending
    if (raw[i] === "\r") i++;
    if (raw[i] === "\n") i++;
    return row;
  }

  while (i < n) {
    const row = readRow();
    if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
  }
  return rows;
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^﻿/, ""); // strip BOM
  return s === "" ? null : s;
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function bool(v) {
  if (v === "1" || v === "true" || v === "TRUE") return true;
  if (v === "0" || v === "false" || v === "FALSE" || v === "") return false;
  return null;
}

function phone(v) {
  const s = str(v);
  if (!s) return null;
  // Remove embedded newlines and extra whitespace that n8n DataTable sometimes adds
  return s.replace(/\s+/g, "").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8").replace(/^﻿/, ""); // strip UTF-8 BOM
  const rows = parseCSV(raw);

  if (rows.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }

  const headers = rows[0].map(h => str(h));
  const dataRows = rows.slice(1);

  console.log(`Parsed ${dataRows.length} rows. Headers: ${headers.join(", ")}`);
  if (DRY_RUN) console.log("DRY RUN — no data will be written\n");

  console.log(`Target: ${BASE_URL}\n`);

  let imported = 0;
  let failed = 0;

  for (const row of dataRows) {
    const r = {};
    headers.forEach((h, i) => { r[h] = row[i] ?? ""; });

    // Map CSV columns to our Firestore case schema
    const doc = {
      tenant_id: TENANT_ID,
      legacy_id: num(r.id),
      phone: phone(r.phone),
      summary: str(r.summary),
      name: str(r.name),
      email: str(r.email),
      city: str(r.city),
      status: str(r.status) || "SENT",
      reminder_count: num(r.reminder_count) ?? 0,
      last_reminder: str(r.last_reminder),
      pipefy_card_id: str(r.pipefy_card_id),
      customer_id: str(r.customer_id),
      category: str(r.category),
      outcome: str(r.outcome),
      last_inbound_sms_at: str(r.last_inbound_sms_at),
      last_inbound_sms_body: str(r.last_inbound_sms_body),
      email_request_sent_at: str(r.email_request_sent_at),
      email_request_count: num(r.email_request_count) ?? 0,
      active: bool(r.active) ?? false,
      original_created_at: str(r.createdAt),
      original_updated_at: str(r.updatedAt),
    };

    // Remove null fields to keep Firestore clean
    Object.keys(doc).forEach(k => { if (doc[k] === null) delete doc[k]; });

    const preview = `[${r.id}] ${doc.phone || "no-phone"} — ${(doc.summary || "").slice(0, 60).replace(/\n/g, " ")}`;

    if (DRY_RUN) {
      console.log(`  WOULD CREATE: ${preview}`);
      imported++;
      continue;
    }

    try {
      const res = await post("/cases", doc);
      if (res.status >= 400) throw new Error(JSON.stringify(res.body));
      console.log(`  ✓ ${preview} → ${res.body.id}`);
      imported++;
    } catch (err) {
      console.error(`  ✗ [${r.id}] ${err.message}`);
      failed++;
    }

    // Small delay to avoid hammering the control-plane
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.log(`\n── Migration complete ──`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Failed:   ${failed}`);
  if (DRY_RUN) console.log(`  (dry run — nothing was written)`);
}

main().catch(err => { console.error(err); process.exit(1); });
