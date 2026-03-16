/**
 * migrate-tenants-to-firestore.js
 *
 * LEGACY — ONE-TIME MIGRATION ONLY. DO NOT USE FOR NORMAL OPERATIONS.
 *
 * This script was used for the initial bulk migration from local files to Firestore.
 * It does NOT stamp _meta on documents, so documents written by this script will
 * trigger the "no _meta" runtime warning in FirestoreTenantProvider.
 *
 * For normal tenant publish, use publish-tenant.js instead:
 *   node scripts/publish-tenant.js <tenantId>
 *
 * This file is kept for historical reference and emergency bulk re-seed only.
 * ─────────────────────────────────────────────────────────────────────────────
 * Original purpose: reads all tenant configs from configs/tenants/,
 * resolves all $file: references, and writes each resolved config
 * as a document in the Firestore "tenants" collection.
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - GOOGLE_CLOUD_PROJECT=ldk-clean (or set in your shell)
 *   - @google-cloud/firestore installed (npm install in apps/voice-bridge/)
 */

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const path = require("path");
const fs = require("fs");

// Re-use the LocalFileTenantProvider for $file: resolution
const LocalFileTenantProvider = require("../apps/voice-bridge/providers/LocalFileTenantProvider");

// Resolve Firestore from where it's actually installed (apps/voice-bridge/node_modules)
const { Firestore } = require(
  require.resolve("@google-cloud/firestore", { paths: [path.join(__dirname, "../apps/voice-bridge")] })
);

const TENANT_CONFIG_DIR = path.join(__dirname, "../configs/tenants");
const includeAll = process.argv.includes("--all");

async function main() {
  const db = new Firestore();
  const provider = new LocalFileTenantProvider();

  const files = fs.readdirSync(TENANT_CONFIG_DIR).filter(f => f.endsWith(".json"));

  if (files.length === 0) {
    console.log("[migrate] No tenant files found in", TENANT_CONFIG_DIR);
    return;
  }

  console.log(`[migrate] Found ${files.length} tenant file(s). includeAll=${includeAll}`);

  for (const file of files) {
    const tenantId = file.replace(".json", "");
    const config = await provider.loadTenant(tenantId);

    if (!config) {
      console.warn(`[migrate] Skipping ${tenantId} — failed to load`);
      continue;
    }

    if (!includeAll && config.status !== "active") {
      console.log(`[migrate] Skipping ${tenantId} (status: ${config.status}) — use --all to include`);
      continue;
    }

    await db.collection("tenants").doc(tenantId).set(config);
    console.log(`[migrate] Written: tenants/${tenantId} (status: ${config.status})`);
  }

  console.log("[migrate] Done.");
}

main().catch(err => {
  console.error("[migrate] Fatal error:", err.message);
  process.exit(1);
});
