/**
 * diff-utils.js
 *
 * Shared helpers for comparing local tenant configs against Firestore documents.
 * Used by diff-tenant.js.
 */

const META_KEY = "_meta";

/**
 * Flatten a nested object to dot-notation keys.
 * Arrays are serialized to JSON string so they compare correctly as values.
 *
 * Example:
 *   { instructions: { base: "..." } }  →  { "instructions.base": "..." }
 *   { unlock_blocks: ["a","b"] }        →  { "unlock_blocks": '["a","b"]' }
 */
function flattenObject(obj, prefix = "") {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(val)) {
      result[fullKey] = JSON.stringify(val);
    } else if (val !== null && typeof val === "object") {
      Object.assign(result, flattenObject(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Strip _meta from a Firestore document before content comparison.
 * Returns { content, meta } so the caller can display _meta separately.
 */
function stripMeta(doc) {
  const { [META_KEY]: meta, ...content } = doc;
  return { content, meta: meta || null };
}

/**
 * Compare two flat objects (local vs firestore).
 * Returns { onlyLocal, onlyFirestore, changed, totalFields }
 *
 * onlyLocal    — keys present in local but not Firestore (unpublished additions)
 * onlyFirestore — keys present in Firestore but not local (hotfix additions or stale fields)
 * changed      — keys present in both but with different values: [{ path, local, firestore }]
 * totalFields  — total unique field count across both
 */
function diffFlat(local, firestore) {
  const allKeys = new Set([...Object.keys(local), ...Object.keys(firestore)]);
  const onlyLocal = [];
  const onlyFirestore = [];
  const changed = [];

  for (const key of allKeys) {
    const inLocal = Object.prototype.hasOwnProperty.call(local, key);
    const inFirestore = Object.prototype.hasOwnProperty.call(firestore, key);

    if (inLocal && !inFirestore) {
      onlyLocal.push(key);
    } else if (!inLocal && inFirestore) {
      onlyFirestore.push(key);
    } else if (local[key] !== firestore[key]) {
      changed.push({ path: key, local: local[key], firestore: firestore[key] });
    }
  }

  return { onlyLocal, onlyFirestore, changed, totalFields: allKeys.size };
}

/**
 * Format a field value for human-readable display.
 * Long strings are truncated with length shown.
 * Arrays (serialized) are shown as-is up to 120 chars.
 */
function formatValue(val, maxLen = 120) {
  if (typeof val === "string" && val.length > maxLen) {
    return `(${val.length} chars) "${val.slice(0, maxLen).replace(/\n/g, "↵")}…"`;
  }
  if (typeof val === "string") {
    return `"${val.replace(/\n/g, "↵")}"`;
  }
  return JSON.stringify(val);
}

module.exports = { flattenObject, stripMeta, diffFlat, formatValue };
