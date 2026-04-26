const crypto = require("crypto");

// Telnyx signs webhooks with Ed25519. The public key is a 32-byte raw key,
// distributed in base64. Node's crypto.createPublicKey wants SPKI-wrapped DER,
// so we prepend the fixed Ed25519 SPKI header.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const TOLERANCE_SEC = 300; // 5-minute replay window

let cachedKey = null;

function getPublicKey() {
  if (cachedKey) return cachedKey;
  const b64 = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!b64) throw new Error("TELNYX_PUBLIC_KEY is not set");
  const rawKey = Buffer.from(b64, "base64");
  if (rawKey.length !== 32) {
    throw new Error(`TELNYX_PUBLIC_KEY decodes to ${rawKey.length} bytes, expected 32`);
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
  cachedKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return cachedKey;
}

// rawBody must be the exact bytes Telnyx sent — verify BEFORE JSON.parse.
function verifyTelnyxSignature(rawBody, signatureHeader, timestampHeader) {
  if (!signatureHeader || !timestampHeader) return { valid: false, reason: "missing_headers" };

  const ts = parseInt(timestampHeader, 10);
  if (Number.isNaN(ts)) return { valid: false, reason: "bad_timestamp" };

  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > TOLERANCE_SEC) return { valid: false, reason: "timestamp_out_of_window", skew };

  const message = Buffer.concat([
    Buffer.from(timestampHeader),
    Buffer.from("|"),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
  const signature = Buffer.from(signatureHeader, "base64");

  let valid = false;
  try {
    valid = crypto.verify(null, message, getPublicKey(), signature);
  } catch (err) {
    return { valid: false, reason: "verify_threw", error: err.message };
  }
  return valid ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}

module.exports = { verifyTelnyxSignature };
