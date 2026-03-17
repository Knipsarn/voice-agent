/**
 * validate-tenant <tenantId>
 *
 * Validates a tenant config from local files before publishing.
 * Checks: file exists, required fields, $file: refs resolved,
 * mode consistency, knowledge_block completeness.
 *
 * Usage (from repo root):
 *   node scripts/validate-tenant.js <tenantId>
 *
 * Exit code 0 = valid. Exit code 1 = errors found.
 */

const LocalFileTenantProvider = require("../apps/voice-bridge/providers/LocalFileTenantProvider");

const REQUIRED_FIELDS = ["tenant_id", "status", "voice", "entry_mode", "instructions"];
const REQUIRED_INSTRUCTIONS = ["base", "default_mode"];

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: node validate-tenant.js <tenantId>");
    process.exit(1);
  }

  const provider = new LocalFileTenantProvider();
  const config = await provider.loadTenant(tenantId);

  if (!config) {
    console.error(`[validate] FAIL: tenant "${tenantId}" could not be loaded — check configs/tenants/${tenantId}.json exists.`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  // Required top-level fields
  for (const field of REQUIRED_FIELDS) {
    if (config[field] == null) errors.push(`Missing required field: ${field}`);
  }

  // Instructions block
  if (config.instructions) {
    for (const field of REQUIRED_INSTRUCTIONS) {
      if (!config.instructions[field]) errors.push(`Missing instructions.${field}`);
    }
    if (typeof config.instructions.base === "string" && config.instructions.base.trim().length < 50) {
      warnings.push(`instructions.base is very short (${config.instructions.base.trim().length} chars) — was $file: ref resolved?`);
    }
  }

  // Default mode exists in modes and is consistent
  const defaultMode = config.instructions?.default_mode;
  if (defaultMode) {
    if (!config.modes?.[defaultMode]) {
      errors.push(`instructions.default_mode = "${defaultMode}" but modes.${defaultMode} does not exist`);
    } else {
      const mode = config.modes[defaultMode];
      if (mode.instructions !== undefined && mode.instructions !== null) {
        if (mode.instructions.trim().length === 0) {
          warnings.push(`modes.${defaultMode}.instructions is present but empty`);
        } else if (mode.instructions.trim().length < 20) {
          warnings.push(`modes.${defaultMode}.instructions is very short — was $file: ref resolved?`);
        }
      }
      // Every unlock_block must exist in knowledge_blocks
      if (Array.isArray(mode.unlock_blocks)) {
        for (const block of mode.unlock_blocks) {
          if (!config.knowledge_blocks?.[block]) {
            errors.push(`modes.${defaultMode}.unlock_blocks references "${block}" but knowledge_blocks.${block} is missing`);
          }
        }
      }
    }
  }

  // Knowledge blocks must not be empty
  if (config.knowledge_blocks) {
    for (const [key, val] of Object.entries(config.knowledge_blocks)) {
      if (!val || val.trim().length === 0) {
        errors.push(`knowledge_blocks.${key} is empty`);
      }
    }
  }

  // Report
  if (warnings.length) {
    warnings.forEach(w => console.warn(`[validate] WARN  ${w}`));
  }

  if (errors.length) {
    errors.forEach(e => console.error(`[validate] ERROR ${e}`));
    console.error(`\n[validate] FAIL — ${errors.length} error(s) for "${tenantId}"`);
    process.exit(1);
  }

  console.log(`[validate] OK — "${tenantId}" passed all checks${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
}

main().catch(err => {
  console.error("[validate] Fatal:", err.message);
  process.exit(1);
});
