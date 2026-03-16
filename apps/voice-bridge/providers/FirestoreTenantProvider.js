const LocalFileTenantProvider = require("./LocalFileTenantProvider");

/**
 * Warn if the loaded Firestore document was not published via publish-tenant.js.
 * Missing _meta means a pre-tooling document (original migration).
 * source !== "git" means it was edited directly in Firestore (hotfix).
 * Warning-only — never blocks the call.
 */
function _warnIfNotFromGit(tenantId, meta) {
  if (!meta) {
    console.warn(
      `[FirestoreTenantProvider] WARNING — tenants/${tenantId} has no _meta. ` +
      `Document predates the publish workflow. Run: node scripts/publish-tenant.js ${tenantId}`
    );
    return;
  }
  if (meta.source !== "git") {
    console.warn(
      `[FirestoreTenantProvider] WARNING — tenants/${tenantId} source="${meta.source}" ` +
      `git_sha=${meta.git_sha || "unknown"}. ` +
      `Direct Firestore edits are hotfix-only and must be back-ported to Git. ` +
      `Run: node scripts/publish-tenant.js ${tenantId}`
    );
  }
}

/**
 * FirestoreTenantProvider
 *
 * Reads tenant configs from Firestore collection "tenants".
 * Falls back to LocalFileTenantProvider on Firestore miss or error.
 *
 * Activate: set TENANT_PROVIDER=firestore in Cloud Run env vars.
 *
 * Firestore layout:
 *   Collection: tenants
 *   Document:   <tenantId>   (e.g. "enklare-juridik")
 *   Fields:     all resolved tenant config fields (no $file: refs — plain strings)
 *
 * In Cloud Run: credentials and project ID are auto-detected from the environment.
 * Locally: run `gcloud auth application-default login` and set GOOGLE_CLOUD_PROJECT=ldk-clean.
 */
class FirestoreTenantProvider {
  constructor() {
    this._db = null;
    this._localFallback = new LocalFileTenantProvider();
  }

  _getDb() {
    if (!this._db) {
      const { Firestore } = require("@google-cloud/firestore");
      // No config needed in Cloud Run — auto-detects project and credentials.
      // Locally: set GOOGLE_CLOUD_PROJECT and use application default credentials.
      this._db = new Firestore();
    }
    return this._db;
  }

  async loadTenant(tenantId) {
    if (!tenantId) {
      console.warn("[FirestoreTenantProvider] loadTenant called without tenantId");
      return null;
    }

    try {
      const db = this._getDb();
      const doc = await db.collection("tenants").doc(tenantId).get();

      if (!doc.exists) {
        console.warn(`[FirestoreTenantProvider] Tenant not found in Firestore: ${tenantId} — falling back to local`);
        return this._localFallback.loadTenant(tenantId);
      }

      const data = doc.data();
      console.log(`[FirestoreTenantProvider] Loaded config for tenant: ${tenantId}`);
      _warnIfNotFromGit(tenantId, data._meta);
      return data;
    } catch (err) {
      console.error(`[FirestoreTenantProvider] Error loading tenant ${tenantId}: ${err.message} — falling back to local`);
      return this._localFallback.loadTenant(tenantId);
    }
  }
}

module.exports = FirestoreTenantProvider;
