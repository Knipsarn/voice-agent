/**
 * lib/fortnox-tokens.js
 *
 * Manages Fortnox OAuth2 tokens. Tokens are stored in Firestore
 * `fortnox_auth/tokens` (single global doc — one Fortnox account per platform).
 *
 * Access tokens last 1 hour; refresh tokens last 45 days.
 * We auto-refresh when less than 2 minutes remain.
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");

const CLIENT_ID = process.env.FORTNOX_CLIENT_ID;
const CLIENT_SECRET = process.env.FORTNOX_CLIENT_SECRET;
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

async function getStoredTokens() {
  const snap = await getDb().collection("fortnox_auth").doc("tokens").get();
  if (!snap.exists) return null;
  return snap.data();
}

async function storeTokens({ access_token, refresh_token, expires_in }) {
  const expires_at = Date.now() + (expires_in || 3600) * 1000;
  await getDb().collection("fortnox_auth").doc("tokens").set({
    access_token,
    refresh_token,
    expires_at,
    updated_at: FieldValue.serverTimestamp(),
  });
  return { access_token, refresh_token, expires_at };
}

async function tokenRequest(params) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET not configured");
  }
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${creds}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Fortnox token request failed: ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function exchangeCode(code, redirectUri) {
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  return storeTokens(data);
}

async function getValidAccessToken() {
  const stored = await getStoredTokens();
  if (!stored) throw new Error("Fortnox not connected — run OAuth flow first");

  if (stored.expires_at > Date.now() + 120000) {
    return stored.access_token;
  }

  // Refresh
  const data = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
  });
  // Fortnox issues a new refresh_token on each refresh; old one becomes invalid.
  const refreshToken = data.refresh_token || stored.refresh_token;
  const tokens = await storeTokens({ ...data, refresh_token: refreshToken });
  return tokens.access_token;
}

module.exports = { exchangeCode, getValidAccessToken, getStoredTokens };
