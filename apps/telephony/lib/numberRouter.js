const { Firestore } = require("@google-cloud/firestore");
const { log, logError } = require("./log");

const COLLECTION = "phone_numbers";
const CACHE_TTL_MS = 60 * 1000;

let firestore = null;
function getDb() {
  if (!firestore) {
    firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean",
    });
  }
  return firestore;
}

// In-memory cache: e164 → { tenantId, expiresAt }
// Keeps Firestore reads off the call-routing hot path during call bursts.
// TTL is short (60s) so cutover changes propagate quickly without restart.
const cache = new Map();

function cacheGet(e164) {
  const entry = cache.get(e164);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(e164);
    return null;
  }
  return entry;
}

function cacheSet(e164, value) {
  cache.set(e164, { ...value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Look up the tenant that owns a destination number.
// Returns { tenantId } on hit, null on miss. Caches both hits and misses (briefly).
async function lookupTenantByNumber(e164) {
  const cached = cacheGet(e164);
  if (cached) return cached.tenantId ? { tenantId: cached.tenantId } : null;

  try {
    const snap = await getDb().collection(COLLECTION).doc(e164).get();
    if (!snap.exists) {
      cacheSet(e164, { tenantId: null });
      return null;
    }
    const data = snap.data();
    if (data.status && data.status !== "active") {
      log("number_inactive", { e164, status: data.status });
      cacheSet(e164, { tenantId: null });
      return null;
    }
    cacheSet(e164, { tenantId: data.tenant_id });
    return { tenantId: data.tenant_id };
  } catch (err) {
    logError("number_lookup_error", { e164, error: err.message });
    return null;
  }
}

module.exports = { lookupTenantByNumber };
