const fs = require("fs");
const path = require("path");

// Repo root: three levels up from apps/voice-bridge/providers/
const REPO_ROOT = path.join(__dirname, "../../..");

const TENANT_CONFIG_DIR =
  process.env.TENANT_CONFIG_DIR ||
  path.join(REPO_ROOT, "configs/tenants");

/**
 * Resolve a config value.
 * If the value starts with "$file:", read the file at that repo-relative path.
 * Otherwise return the value as-is (inline string).
 */
function resolveValue(value) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("$file:")) return value;

  const relPath = value.slice("$file:".length).trim();
  const absPath = path.join(REPO_ROOT, relPath);

  try {
    return fs.readFileSync(absPath, "utf8").trim();
  } catch (err) {
    console.warn(`[LocalFileTenantProvider] Could not read file ref "${relPath}": ${err.message}`);
    return "";
  }
}

/**
 * Walk the tenant config and resolve all $file: references in place.
 * Returns a new config object with only inline strings — no refs remaining.
 */
function resolveConfig(config) {
  const resolved = { ...config };

  if (resolved.instructions) {
    resolved.instructions = {
      ...resolved.instructions,
      base: resolveValue(resolved.instructions.base)
    };
  }

  if (resolved.modes) {
    resolved.modes = Object.fromEntries(
      Object.entries(resolved.modes).map(([key, mode]) => {
        const resolvedMode = { ...mode };
        if (mode.instructions !== undefined) {
          resolvedMode.instructions = resolveValue(mode.instructions);
        }
        return [key, resolvedMode];
      })
    );
  }

  if (resolved.knowledge_blocks) {
    resolved.knowledge_blocks = Object.fromEntries(
      Object.entries(resolved.knowledge_blocks).map(([key, val]) => [
        key,
        resolveValue(val)
      ])
    );
  }

  return resolved;
}

class LocalFileTenantProvider {
  constructor() {
    if (!fs.existsSync(TENANT_CONFIG_DIR)) {
      console.warn(`[LocalFileTenantProvider] Tenant config directory not found: ${TENANT_CONFIG_DIR}`);
    } else {
      console.log(`[LocalFileTenantProvider] Tenant config dir OK: ${TENANT_CONFIG_DIR}`);
    }
  }

  async loadTenant(tenantId) {
    if (!tenantId) {
      console.warn("[LocalFileTenantProvider] loadTenant called without tenantId");
      return null;
    }

    const filePath = path.join(TENANT_CONFIG_DIR, `${tenantId}.json`);

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const config = JSON.parse(raw);
      console.log(`[LocalFileTenantProvider] Loaded config for tenant: ${tenantId}`);
      return resolveConfig(config);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.warn(`[LocalFileTenantProvider] No config file found for tenant: ${tenantId} (path: ${filePath})`);
      } else {
        console.error(`[LocalFileTenantProvider] Failed to load tenant ${tenantId}:`, err.message);
      }
      return null;
    }
  }
}

module.exports = LocalFileTenantProvider;
