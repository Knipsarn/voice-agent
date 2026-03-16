/**
 * pull-tenant-from-firestore <tenantId> [--no-meta]
 *
 * Fetches and prints the live Firestore document for a tenant.
 * Shows the exact data the bridge is reading in production.
 *
 * Usage (from repo root):
 *   GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/pull-tenant-from-firestore.js <tenantId>
 *   GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/pull-tenant-from-firestore.js <tenantId> --no-meta
 *
 * --no-meta: strips _meta before printing (shows only tenant config content)
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - GOOGLE_CLOUD_PROJECT=ldk-clean (or set in env)
 */

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const path = require("path");
const { stripMeta } = require("./lib/diff-utils");

const { Firestore } = require(
  require.resolve("@google-cloud/firestore", { paths: [path.join(__dirname, "../apps/voice-bridge")] })
);

async function main() {
  const tenantId = process.argv[2];
  const noMeta = process.argv.includes("--no-meta");

  if (!tenantId) {
    console.error("Usage: node pull-tenant-from-firestore.js <tenantId> [--no-meta]");
    process.exit(1);
  }

  const db = new Firestore();
  const doc = await db.collection("tenants").doc(tenantId).get();

  if (!doc.exists) {
    console.error(`[pull] NOT FOUND — tenants/${tenantId} does not exist in Firestore.`);
    console.error(`[pull] Run: node scripts/publish-tenant.js ${tenantId}`);
    process.exit(1);
  }

  const data = doc.data();
  const { content, meta } = stripMeta(data);

  // Always print _meta summary first so it's easy to spot
  if (meta) {
    console.log(`[pull] tenants/${tenantId} — _meta:`);
    console.log(`       published_at:   ${meta.published_at}`);
    console.log(`       git_sha:        ${meta.git_sha}`);
    console.log(`       source:         ${meta.source}`);
    console.log(`       schema_version: ${meta.schema_version}`);
    console.log("");
  } else {
    console.warn(`[pull] WARNING — no _meta found on tenants/${tenantId}. Document was not published via publish-tenant.js.`);
    console.warn(`[pull] Run: node scripts/publish-tenant.js ${tenantId}  to stamp metadata.`);
    console.log("");
  }

  const output = noMeta ? content : data;
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("[pull] Fatal:", err.message);
  process.exit(1);
});
