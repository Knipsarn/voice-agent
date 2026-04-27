#!/usr/bin/env node
/**
 * scripts/ops/fortnox-connect.js
 *
 * One-time Fortnox OAuth setup. Run this locally once to authorize and
 * store tokens in Firestore. Never needs to be run again unless the
 * refresh token expires (45 days without any API call).
 *
 * Usage:
 *   node scripts/ops/fortnox-connect.js
 *
 * What it does:
 *   1. Opens your browser to the Fortnox authorization page
 *   2. You click Authorize in Fortnox
 *   3. Fortnox redirects to localhost:9876/callback
 *   4. Script exchanges the code for tokens
 *   5. Tokens saved to Firestore fortnox_auth/tokens
 *   6. Done — the dashboard and control-plane can now create invoices
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const http = require("http");
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const CLIENT_ID = process.env.FORTNOX_CLIENT_ID;
const CLIENT_SECRET = process.env.FORTNOX_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:9876/callback";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET must be set in config/.env");
  process.exit(1);
}

const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });

const authUrl = `${AUTH_URL}?${new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: "invoice",
  state: "local_connect",
  response_type: "code",
  access_type: "offline",
}).toString()}`;

console.log("\n📋  Opening Fortnox authorization...");
console.log("\n   If the browser doesn't open automatically, visit:\n");
console.log("   " + authUrl + "\n");

// Try to open browser
const { exec } = require("child_process");
exec(`start "" "${authUrl}"`, () => {});  // Windows

// Start local HTTP server to catch the callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) {
    res.end("waiting...");
    return;
  }

  const url = new URL(req.url, "http://localhost:9876");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2 style="color:red">Error: ${error}</h2><p>Check the terminal for details.</p>`);
    console.error(`\n❌  Fortnox returned error: ${error}`);
    console.error("    Common cause: API access not enabled on your Fortnox plan.");
    console.error("    Contact Fortnox support to enable API / Faktura API access.\n");
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end("No code received.");
    server.close();
    return;
  }

  try {
    console.log("✅  Authorization code received — exchanging for tokens...");

    const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${creds}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
    }

    const data = await tokenRes.json();
    const expires_at = Date.now() + (data.expires_in || 3600) * 1000;

    await db.collection("fortnox_auth").doc("tokens").set({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at,
      updated_at: FieldValue.serverTimestamp(),
    });

    console.log("✅  Tokens stored in Firestore (fortnox_auth/tokens)");
    console.log(`    Access token expires: ${new Date(expires_at).toLocaleString()}`);
    console.log("    Refresh token stored — will auto-renew.\n");
    console.log("🎉  Fortnox is connected! You can now create invoices from the dashboard.\n");

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:500px">
        <h2 style="color:green">✅ Fortnox connected!</h2>
        <p>Tokens have been saved. You can close this tab.</p>
        <p>Go to the dashboard billing page to create your first invoice.</p>
      </body></html>
    `);
  } catch (err) {
    console.error(`\n❌  ${err.message}\n`);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2 style="color:red">Error</h2><pre>${err.message}</pre>`);
  }

  server.close();
});

server.listen(9876, () => {
  console.log("   Waiting for Fortnox redirect on http://localhost:9876/callback ...\n");
});
