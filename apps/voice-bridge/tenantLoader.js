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
 * Also overlays customer-editable runtime overrides from `tenant_settings/<id>`:
 *   - first_message: the spoken greeting (customers can edit from dashboard)
 *
 * @param {string} tenantId
 * @returns {Promise<object|null>}
 */
async function loadTenant(tenantId) {
  const config = await provider.loadTenant(tenantId);
  if (!config) return null;
  return applyTenantSettingsOverrides(tenantId, config);
}

let _firestore = null;
function getFirestore() {
  if (_firestore) return _firestore;
  try {
    const { Firestore } = require("@google-cloud/firestore");
    _firestore = new Firestore();
    return _firestore;
  } catch (err) {
    return null;
  }
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function getBusinessHoursNotice(bh) {
  try {
    const tz = bh.timezone || "Europe/Stockholm";
    const now = new Date();
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(now);
    const dayAbbr = parts.find(p => p.type === "weekday")?.value?.toLowerCase()?.slice(0, 3);
    const timeStr = `${parts.find(p => p.type === "hour")?.value}:${parts.find(p => p.type === "minute")?.value}`;
    const dayKey = DAY_KEYS.find(d => dayAbbr?.startsWith(d.slice(0, 2))) || DAY_KEYS[now.getDay()];
    const hours = bh.schedule?.[dayKey];
    if (!hours) {
      return `OBS: Det är nu stängt (${dayKey} är stängt). Informera uppringaren vänligt om att vi är stängda idag och be dem ringa tillbaka under öppettiderna.`;
    }
    if (timeStr < hours.open || timeStr >= hours.close) {
      return `OBS: Det är nu utanför öppettiderna (kl ${timeStr}, öppet ${hours.open}–${hours.close}). Informera uppringaren vänligt och erbjud att de kan ringa tillbaka under öppettiderna eller lämna ett meddelande.`;
    }
    return null; // within hours
  } catch {
    return null;
  }
}

async function applyTenantSettingsOverrides(tenantId, config) {
  const db = getFirestore();
  if (!db) return config;
  try {
    const snap = await db.collection("tenant_settings").doc(tenantId).get();
    if (!snap.exists) return config;
    const overrides = snap.data() || {};
    const out = { ...config };
    if (overrides.first_message && typeof overrides.first_message === "string") {
      out.first_message = overrides.first_message;
      out._overrides = { ...(out._overrides || {}), first_message: true };
    }

    // Business hours: if enabled and currently outside hours, prepend a closed notice
    if (overrides.business_hours?.enabled) {
      const closedNotice = getBusinessHoursNotice(overrides.business_hours);
      if (closedNotice) {
        out._business_hours_closed = true;
        out._business_hours_notice = closedNotice;
        // Prepend to instructions so the agent knows it's closed
        if (out.instructions) {
          if (typeof out.instructions === "string") {
            out.instructions = `${closedNotice}\n\n${out.instructions}`;
          } else if (out.instructions.base) {
            out.instructions = { ...out.instructions, base: `${closedNotice}\n\n${out.instructions.base}` };
          }
        }
      }
    }

    return out;
  } catch (err) {
    console.warn(`[tenantLoader] Failed to apply tenant_settings override for ${tenantId}: ${err.message}`);
    return config;
  }
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
