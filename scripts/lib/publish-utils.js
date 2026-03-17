/**
 * publish-utils.js
 *
 * Shared publish logic used by:
 *   - scripts/publish-tenant.js  (CLI)
 *   - apps/control-plane/routes/tenants.js  (HTTP API)
 *
 * publishTenant() never throws — always returns a structured result object.
 */

const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "../..");
const REQUIRED_FIELDS = ["tenant_id", "status", "voice", "entry_mode", "instructions"];
const REQUIRED_INSTRUCTIONS = ["base"];
const SCHEMA_VERSION = 1;

function getGitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  for (const field of REQUIRED_FIELDS) {
    if (config[field] == null) errors.push(`Missing required field: ${field}`);
  }

  if (config.instructions) {
    for (const field of REQUIRED_INSTRUCTIONS) {
      if (!config.instructions[field]) errors.push(`Missing instructions.${field}`);
    }
    if (typeof config.instructions.base === "string" && config.instructions.base.trim().length < 50) {
      warnings.push(`instructions.base is very short — was $file: ref resolved?`);
    }
  }

  // Workflow tenants use workflow.initial_mode instead of instructions.default_mode
  const workflowEnabled = !!config.workflow?.enabled;
  if (!workflowEnabled && !config.instructions?.default_mode) {
    errors.push(`Missing instructions.default_mode (required for non-workflow tenants)`);
  }

  const defaultMode = config.instructions?.default_mode;
  if (defaultMode) {
    if (!config.modes?.[defaultMode]) {
      errors.push(`instructions.default_mode = "${defaultMode}" but modes.${defaultMode} does not exist`);
    } else {
      const mode = config.modes[defaultMode];
      if (mode.instructions !== undefined && mode.instructions !== null && mode.instructions.trim().length === 0) {
        warnings.push(`modes.${defaultMode}.instructions is present but empty`);
      }
      if (Array.isArray(mode.unlock_blocks)) {
        for (const block of mode.unlock_blocks) {
          if (!config.knowledge_blocks?.[block]) {
            errors.push(`modes.${defaultMode}.unlock_blocks references "${block}" but knowledge_blocks.${block} is missing`);
          }
        }
      }
    }
  }

  if (config.knowledge_blocks) {
    for (const [key, val] of Object.entries(config.knowledge_blocks)) {
      if (!val || val.trim().length === 0) {
        errors.push(`knowledge_blocks.${key} is empty`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * publishTenant(tenantId, options)
 *
 * Loads from local files, validates, stamps _meta, and writes to Firestore.
 * Pass { dryRun: true } to validate and return what would be written without writing.
 * Pass { db } to reuse an existing Firestore instance (avoids creating a new client per call).
 *
 * Always returns a result object — never throws.
 *
 * @param {string} tenantId
 * @param {{ dryRun?: boolean, provider?: object, db?: object }} options
 * @returns {Promise<Result>}
 */
async function publishTenant(tenantId, { dryRun = false, provider, db } = {}) {
  // Load config via LocalFileTenantProvider
  if (!provider) {
    const LocalFileTenantProvider = require("../../apps/voice-bridge/providers/LocalFileTenantProvider");
    provider = new LocalFileTenantProvider();
  }

  const config = await provider.loadTenant(tenantId);

  if (!config) {
    return {
      success: false,
      tenant_id: tenantId,
      dry_run: dryRun,
      error: `Tenant "${tenantId}" not found in local files. Check configs/tenants/${tenantId}.json exists.`,
      validation_errors: [],
      validation_warnings: [],
    };
  }

  // Validate
  const { errors, warnings } = validateConfig(config);

  if (errors.length > 0) {
    return {
      success: false,
      tenant_id: tenantId,
      dry_run: dryRun,
      error: `Validation failed — ${errors.length} error(s)`,
      validation_errors: errors,
      validation_warnings: warnings,
    };
  }

  // Stamp metadata
  const gitSha = getGitSha();
  const publishedAt = new Date().toISOString();
  const document = {
    ...config,
    _meta: {
      published_at: publishedAt,
      git_sha: gitSha,
      source: "git",
      schema_version: SCHEMA_VERSION,
    },
  };

  if (dryRun) {
    return {
      success: true,
      tenant_id: tenantId,
      dry_run: true,
      git_sha: gitSha,
      published_at: publishedAt,
      validation_errors: [],
      validation_warnings: warnings,
    };
  }

  // Write to Firestore
  try {
    if (!db) {
      const { Firestore } = require(
        require.resolve("@google-cloud/firestore", { paths: [path.join(REPO_ROOT, "apps/voice-bridge")] })
      );
      db = new Firestore();
    }
    const safeDoc = JSON.parse(JSON.stringify(document));
    await db.collection("tenants").doc(tenantId).set(safeDoc);
  } catch (err) {
    return {
      success: false,
      tenant_id: tenantId,
      dry_run: false,
      error: `Firestore write failed: ${err.message}`,
      validation_errors: [],
      validation_warnings: warnings,
    };
  }

  return {
    success: true,
    tenant_id: tenantId,
    dry_run: false,
    git_sha: gitSha,
    published_at: publishedAt,
    validation_errors: [],
    validation_warnings: warnings,
  };
}

module.exports = { publishTenant, validateConfig, getGitSha, SCHEMA_VERSION };
