/**
 * routes/tenants.js
 *
 * Read-only tenant inspection endpoints.
 * All data is pulled from Firestore and/or local Git configs.
 * No write actions in Sequence 1.
 *
 * Routes:
 *   GET /tenants                — list all tenants (summary)
 *   GET /tenants/:id            — full Firestore document
 *   GET /tenants/:id/meta       — _meta only
 *   GET /tenants/:id/validate   — validate local config, return errors/warnings
 *   GET /tenants/:id/diff       — field-level diff: local vs Firestore
 */

const express = require("express");
const path = require("path");
const router = express.Router();

const { Firestore } = require("@google-cloud/firestore");

// Override any relative TENANT_CONFIG_DIR from .env — control-plane always uses the absolute repo path
process.env.TENANT_CONFIG_DIR = path.join(__dirname, "../../../configs/tenants");
const LocalFileTenantProvider = require("../../voice-bridge/providers/LocalFileTenantProvider");
const { flattenObject, stripMeta, diffFlat } = require("../../../scripts/lib/diff-utils");
const { publishTenant } = require("../../../scripts/lib/publish-utils");

const db = new Firestore();
const localProvider = new LocalFileTenantProvider();

// ── Validation logic (mirrors validate-tenant.js, returns structured result) ─
const REQUIRED_FIELDS = ["tenant_id", "status", "voice", "entry_mode", "instructions"];
const REQUIRED_INSTRUCTIONS = ["base", "default_mode"];

function runValidation(config, tenantId) {
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
      warnings.push(`instructions.base is very short (${config.instructions.base.trim().length} chars) — was $file: ref resolved?`);
    }
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

// ── Truncate long strings for diff output ────────────────────────────────────
function truncateIfLong(val, maxLen = 120) {
  if (typeof val === "string" && val.length > maxLen) {
    return val.slice(0, maxLen) + "…";
  }
  return val;
}

// ── GET /tenants ─────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("tenants").get();
    const tenants = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        tenant_id: doc.id,
        company_name: data.company_name || null,
        status: data.status || null,
        voice: data.voice || null,
        entry_mode: data.entry_mode || null,
        _meta: data._meta || null,
      };
    });
    res.json({ count: tenants.length, tenants });
  } catch (err) {
    console.error("[/tenants] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tenants/:id ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const doc = await db.collection("tenants").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: `Tenant not found in Firestore: ${req.params.id}` });
    }
    res.json(doc.data());
  } catch (err) {
    console.error(`[/tenants/${req.params.id}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tenants/:id/meta ────────────────────────────────────────────────────
router.get("/:id/meta", async (req, res) => {
  try {
    const doc = await db.collection("tenants").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: `Tenant not found in Firestore: ${req.params.id}` });
    }
    const data = doc.data();
    if (!data._meta) {
      return res.json({
        tenant_id: req.params.id,
        _meta: null,
        warning: `No _meta — document predates publish workflow. Run: node scripts/publish-tenant.js ${req.params.id}`,
      });
    }
    res.json({ tenant_id: req.params.id, _meta: data._meta });
  } catch (err) {
    console.error(`[/tenants/${req.params.id}/meta] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tenants/:id/validate ────────────────────────────────────────────────
router.get("/:id/validate", async (req, res) => {
  const tenantId = req.params.id;
  try {
    const config = await localProvider.loadTenant(tenantId);
    if (!config) {
      return res.status(404).json({
        tenant_id: tenantId,
        valid: false,
        errors: [`Local config not found: configs/tenants/${tenantId}.json`],
        warnings: [],
      });
    }
    const { errors, warnings } = runValidation(config, tenantId);
    res.json({
      tenant_id: tenantId,
      valid: errors.length === 0,
      errors,
      warnings,
    });
  } catch (err) {
    console.error(`[/tenants/${tenantId}/validate] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tenants/:id/diff ────────────────────────────────────────────────────
router.get("/:id/diff", async (req, res) => {
  const tenantId = req.params.id;
  try {
    // Load local (resolves $file: refs — same path as publish-tenant.js)
    const localConfig = await localProvider.loadTenant(tenantId);
    if (!localConfig) {
      return res.status(404).json({
        error: `Local config not found for tenant: ${tenantId}`,
        hint: `Check configs/tenants/${tenantId}.json exists`,
      });
    }

    // Load Firestore document
    const doc = await db.collection("tenants").doc(tenantId).get();
    if (!doc.exists) {
      return res.status(404).json({
        error: `Firestore document not found for tenant: ${tenantId}`,
        hint: `Run: node scripts/publish-tenant.js ${tenantId}`,
      });
    }

    const { content: firestoreContent, meta } = stripMeta(doc.data());

    // Diff
    const flatLocal = flattenObject(localConfig);
    const flatFirestore = flattenObject(firestoreContent);
    const { onlyLocal, onlyFirestore, changed, totalFields } = diffFlat(flatLocal, flatFirestore);
    const driftCount = onlyLocal.length + onlyFirestore.length + changed.length;

    res.json({
      tenant_id: tenantId,
      _meta: meta,
      match: driftCount === 0,
      total_fields: totalFields,
      drift_count: driftCount,
      only_in_local: onlyLocal,
      only_in_firestore: onlyFirestore,
      changed: changed.map(({ path: fieldPath, local, firestore }) => ({
        path: fieldPath,
        local: truncateIfLong(local),
        firestore: truncateIfLong(firestore),
      })),
    });
  } catch (err) {
    console.error(`[/tenants/${tenantId}/diff] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /tenants/:id/publish ────────────────────────────────────────────────
// Validates and publishes the local tenant config to Firestore.
// ?dry_run=true performs validation only — no Firestore write.
router.post("/:id/publish", async (req, res) => {
  const tenantId = req.params.id;
  const dryRun = req.query.dry_run === "true" || req.body?.dry_run === true;

  try {
    // Pass the existing db instance to avoid creating a new Firestore client
    const result = await publishTenant(tenantId, { dryRun, db });
    res.status(result.success ? 200 : 422).json(result);
  } catch (err) {
    console.error(`[POST /tenants/${tenantId}/publish] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
