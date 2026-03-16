/**
 * diff-tenant <tenantId>
 *
 * Compares the local resolved tenant config (Git) against the live Firestore document.
 * Reports field-level drift so you know whether the runtime matches the authoring source.
 *
 * _meta fields are shown as context but excluded from the content diff.
 *
 * Usage (from repo root):
 *   GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/diff-tenant.js <tenantId>
 *
 * Exit code 0 = match or diff found (informational).
 * Exit code 1 = fatal error (missing tenant, Firestore unavailable).
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - GOOGLE_CLOUD_PROJECT=ldk-clean (or set in env)
 */

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const path = require("path");
const LocalFileTenantProvider = require("../apps/voice-bridge/providers/LocalFileTenantProvider");
const { flattenObject, stripMeta, diffFlat, formatValue } = require("./lib/diff-utils");

const { Firestore } = require(
  require.resolve("@google-cloud/firestore", { paths: [path.join(__dirname, "../apps/voice-bridge")] })
);

const SEP = "─".repeat(60);

async function main() {
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error("Usage: node diff-tenant.js <tenantId>");
    process.exit(1);
  }

  console.log(`[diff] ${SEP}`);
  console.log(`[diff] Tenant: ${tenantId}`);
  console.log(`[diff] ${SEP}`);

  // ── Load local config (same resolution path as publish-tenant) ──────────
  const provider = new LocalFileTenantProvider();
  const localConfig = await provider.loadTenant(tenantId);

  if (!localConfig) {
    console.error(`[diff] FAIL — could not load local config for "${tenantId}".`);
    console.error(`[diff] Check: configs/tenants/${tenantId}.json exists and is valid.`);
    process.exit(1);
  }
  console.log(`[diff] Local:     configs/tenants/${tenantId}.json (resolved)`);

  // ── Fetch Firestore document ─────────────────────────────────────────────
  const db = new Firestore();
  const doc = await db.collection("tenants").doc(tenantId).get();

  if (!doc.exists) {
    console.error(`[diff] FAIL — tenants/${tenantId} not found in Firestore.`);
    console.error(`[diff] Run: node scripts/publish-tenant.js ${tenantId}`);
    process.exit(1);
  }

  const rawFirestore = doc.data();
  const { content: firestoreContent, meta } = stripMeta(rawFirestore);

  // ── Show _meta ────────────────────────────────────────────────────────────
  if (meta) {
    console.log(`[diff] Firestore: tenants/${tenantId}`);
    console.log(`[diff]            published_at:   ${meta.published_at}`);
    console.log(`[diff]            git_sha:        ${meta.git_sha}`);
    console.log(`[diff]            source:         ${meta.source}`);
    console.log(`[diff]            schema_version: ${meta.schema_version}`);
    if (meta.source !== "git") {
      console.warn(`[diff] WARNING — source is "${meta.source}". This document was not published via publish-tenant.js.`);
    }
  } else {
    console.warn(`[diff] Firestore: tenants/${tenantId} — no _meta (pre-tooling document)`);
    console.warn(`[diff] WARNING — run publish-tenant.js to stamp metadata.`);
  }

  console.log(`[diff] ${SEP}`);

  // ── Flatten both sides and diff ──────────────────────────────────────────
  const flatLocal = flattenObject(localConfig);
  const flatFirestore = flattenObject(firestoreContent);
  const { onlyLocal, onlyFirestore, changed, totalFields } = diffFlat(flatLocal, flatFirestore);

  const driftCount = onlyLocal.length + onlyFirestore.length + changed.length;

  if (driftCount === 0) {
    console.log(`[diff] MATCH — local and Firestore content are identical (${totalFields} fields checked).`);
    return;
  }

  console.log(`[diff] DRIFT DETECTED — ${driftCount} difference(s) across ${totalFields} fields:\n`);

  let index = 1;

  // Fields only in local (not yet published to Firestore)
  for (const key of onlyLocal) {
    console.log(`  [${index++}] ${key}`);
    console.log(`        status:    only in local (not published to Firestore)`);
    console.log(`        local:     ${formatValue(flatLocal[key])}`);
    console.log("");
  }

  // Fields only in Firestore (not in local — hotfix or stale)
  for (const key of onlyFirestore) {
    console.log(`  [${index++}] ${key}`);
    console.log(`        status:    only in Firestore (hotfix? or removed from Git?)`);
    console.log(`        firestore: ${formatValue(flatFirestore[key])}`);
    console.log("");
  }

  // Fields present in both but with different values
  for (const { path: fieldPath, local: localVal, firestore: fsVal } of changed) {
    console.log(`  [${index++}] ${fieldPath}`);
    console.log(`        local:     ${formatValue(localVal)}`);
    console.log(`        firestore: ${formatValue(fsVal)}`);
    console.log("");
  }

  console.log(`[diff] Run 'node scripts/publish-tenant.js ${tenantId}' to sync local → Firestore.`);
}

main().catch(err => {
  console.error("[diff] Fatal:", err.message);
  process.exit(1);
});
