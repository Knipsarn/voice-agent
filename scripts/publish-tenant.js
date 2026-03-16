/**
 * publish-tenant <tenantId> [--dry-run]
 *
 * CLI wrapper around scripts/lib/publish-utils.js.
 * Validates a tenant config from local files, then publishes it to Firestore.
 * Stamps the Firestore document with _meta (published_at, git_sha, source, schema_version).
 *
 * Usage (from repo root):
 *   GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/publish-tenant.js <tenantId>
 *   GOOGLE_CLOUD_PROJECT=ldk-clean node scripts/publish-tenant.js <tenantId> --dry-run
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - GOOGLE_CLOUD_PROJECT=ldk-clean (or set in env)
 */

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const { publishTenant } = require("./lib/publish-utils");

async function main() {
  const tenantId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!tenantId) {
    console.error("Usage: node publish-tenant.js <tenantId> [--dry-run]");
    process.exit(1);
  }

  const result = await publishTenant(tenantId, { dryRun });

  if (result.validation_warnings.length) {
    result.validation_warnings.forEach(w => console.warn(`[publish] WARN  ${w}`));
  }

  if (!result.success) {
    result.validation_errors.forEach(e => console.error(`[publish] ERROR ${e}`));
    console.error(`[publish] FAIL: ${result.error}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[publish] DRY RUN — would write tenants/${tenantId} with _meta:`);
    console.log(JSON.stringify({ published_at: result.published_at, git_sha: result.git_sha, source: "git", schema_version: 1 }, null, 2));
    console.log(`[publish] DRY RUN complete — no changes written.`);
  } else {
    console.log(`[publish] Published tenants/${tenantId} — git: ${result.git_sha.slice(0, 7)}, source: git`);
  }
}

main().catch(err => {
  console.error("[publish] Fatal:", err.message);
  process.exit(1);
});
