const LocalFileTenantProvider = require("./providers/LocalFileTenantProvider");
const FirestoreTenantProvider = require("./providers/FirestoreTenantProvider");

// ─── Provider selection ───────────────────────────────────────────────────────

const TENANT_PROVIDER = process.env.TENANT_PROVIDER || "local";

function createProvider() {
  switch (TENANT_PROVIDER) {
    case "firestore":
      console.log("[tenantLoader] Provider: firestore");
      return new FirestoreTenantProvider();
    case "local":
    default:
      console.log("[tenantLoader] Provider: local");
      return new LocalFileTenantProvider();
  }
}

const provider = createProvider();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a tenant config by ID.
 * Returns a fully resolved config object (all $file: refs expanded),
 * or null if the tenant is not found.
 *
 * @param {string} tenantId
 * @returns {Promise<object|null>}
 */
async function loadTenant(tenantId) {
  return provider.loadTenant(tenantId);
}

/**
 * Build the GPT session instructions string from a resolved tenant config.
 * Combines base + default mode instructions + unlocked knowledge blocks.
 * Provider-agnostic: expects all values to already be inline strings.
 *
 * @param {object} tenantConfig
 * @returns {string}
 */
function buildInstructions(tenantConfig) {
  const parts = [];

  const base = tenantConfig?.instructions?.base;
  if (base) parts.push(base);

  const defaultMode = tenantConfig?.instructions?.default_mode;
  const modeConfig = defaultMode && tenantConfig?.modes?.[defaultMode];

  if (modeConfig?.instructions) {
    parts.push(modeConfig.instructions);
  }

  const unlockBlocks = modeConfig?.unlock_blocks || [];
  for (const blockKey of unlockBlocks) {
    const block = tenantConfig?.knowledge_blocks?.[blockKey];
    if (block) parts.push(block);
  }

  return parts.join("\n\n") || "You are a helpful phone assistant.";
}

module.exports = { loadTenant, buildInstructions };
