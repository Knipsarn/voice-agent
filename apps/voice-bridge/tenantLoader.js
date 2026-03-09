const fs = require("fs");
const path = require("path");

// Default: two levels up from apps/voice-bridge/ -> repo root -> config/tenants/
const TENANT_CONFIG_DIR =
  process.env.TENANT_CONFIG_DIR ||
  path.join(__dirname, "../../config/tenants");

/**
 * Load tenant config from a local JSON file.
 *
 * @param {string} tenantId - The tenant identifier, e.g. "example-company"
 * @returns {object|null} Parsed tenant config, or null if not found or invalid
 */
function loadTenant(tenantId) {
  if (!tenantId) {
    console.warn("[tenantLoader] loadTenant called without tenantId");
    return null;
  }

  const filePath = path.join(TENANT_CONFIG_DIR, `${tenantId}.json`);

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const config = JSON.parse(raw);
    console.log(`[tenantLoader] Loaded config for tenant: ${tenantId}`);
    return config;
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn(`[tenantLoader] No config file found for tenant: ${tenantId} (path: ${filePath})`);
    } else {
      console.error(`[tenantLoader] Failed to load tenant ${tenantId}:`, err.message);
    }
    return null;
  }
}

/**
 * Build the GPT session instructions string from a tenant config.
 * Combines base instructions with the default mode's instructions and
 * any unlocked knowledge blocks.
 *
 * @param {object} tenantConfig - Loaded tenant config object
 * @returns {string} Combined instructions string for the GPT session
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
