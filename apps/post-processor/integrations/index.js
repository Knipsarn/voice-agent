"use strict";
/**
 * integrations/index.js
 *
 * Dispatcher for per-tenant post-call integration hooks.
 * Each tenant can have integrations/<tenantId>/post-call.js that exports
 * an async function(data) => void.
 *
 * Missing integration for a tenant is silently ignored.
 */

const path = require("path");
const { logError } = require("../lib/log");

async function runTenantIntegration(tenantId, data) {
  if (!tenantId) return;

  let handler;
  try {
    handler = require(path.join(__dirname, tenantId, "post-call.js"));
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") return;
    logError("integration_load_failed", { tenant_id: tenantId, error: err.message });
    return;
  }

  await handler(data);
}

module.exports = { runTenantIntegration };
