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

/**
 * Build instructions for a specific workflow mode.
 * Returns: base system prompt + mode-specific instructions.
 *
 * @param {object} tenantConfig
 * @param {string} modeName
 * @returns {string}
 */
function buildWorkflowInstructions(tenantConfig, modeName) {
  const parts = [];

  const base = tenantConfig?.instructions?.base;
  if (base) parts.push(base);

  const modeConfig = tenantConfig?.workflow?.modes?.[modeName];
  if (modeConfig?.instructions) parts.push(modeConfig.instructions);

  return parts.join("\n\n") || "You are a helpful phone assistant.";
}

/**
 * Generate OpenAI function tool definitions for a workflow mode.
 * Automatically creates transfer_to_X tools from the mode's transfers map.
 *
 * @param {object} tenantConfig
 * @param {string} modeName
 * @returns {Array} Array of OpenAI tool definitions
 */
function generateWorkflowTools(tenantConfig, modeName) {
  const tools = [];
  const modeConfig = tenantConfig?.workflow?.modes?.[modeName];

  // Auto-generate transfer tools from the mode's transfers map
  if (modeConfig?.transfers) {
    for (const [fnName, condition] of Object.entries(modeConfig.transfers)) {
      tools.push({
        type: "function",
        name: fnName,
        description: `Anropa denna funktion för att gå vidare. Villkor: ${condition}`,
        parameters: { type: "object", properties: {}, required: [] }
      });
    }
  }

  // backward_to: allows routing back to a parent mode
  if (modeConfig?.backward_to) {
    const parentMode = modeConfig.backward_to;
    tools.push({
      type: "function",
      name: `transfer_to_${parentMode}`,
      description: `Gå tillbaka till ${parentMode} om ärendet var felkategoriserat.`,
      parameters: { type: "object", properties: {}, required: [] }
    });
  }

  return tools;
}

/**
 * Check if a tenant config uses the workflow system.
 * @param {object} tenantConfig
 * @returns {boolean}
 */
function isWorkflowEnabled(tenantConfig) {
  return !!tenantConfig?.workflow?.enabled;
}

module.exports = { loadTenant, buildInstructions, buildWorkflowInstructions, generateWorkflowTools, isWorkflowEnabled };
