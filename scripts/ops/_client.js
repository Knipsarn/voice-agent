/**
 * scripts/ops/_client.js
 *
 * Shared HTTP client for operator shell scripts.
 * Reads CONTROL_PLANE_BASE_URL and CONTROL_PLANE_API_KEY from env or config/.env.
 */

// Load config/.env without requiring dotenv — uses only built-in Node modules
try {
  const fs = require("fs");
  const envPath = require("path").join(__dirname, "../../config/.env");
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {}

// --local flag overrides CONTROL_PLANE_BASE_URL for this invocation only.
// Useful when publishing a new tenant (local control-plane reads new files from disk).
const BASE_URL = process.argv.includes("--local")
  ? "http://localhost:4000"
  : (process.env.CONTROL_PLANE_BASE_URL || "http://localhost:4000");
const API_KEY  = process.env.CONTROL_PLANE_API_KEY;

async function request(method, path, body) {
  const https = BASE_URL.startsWith("https");
  const http  = require(https ? "https" : "http");
  const url   = new URL(path, BASE_URL);

  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = http.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function get(path)         { return request("GET",  path); }
function post(path, body)  { return request("POST", path, body); }

function print(res) {
  if (res.status >= 400) {
    console.error(`[ops] HTTP ${res.status}`);
    console.error(JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(res.body, null, 2));
}

function handleError(err) {
  if (err.code === "ECONNREFUSED") {
    console.error(`[ops] Connection refused: ${BASE_URL}`);
    console.error(`[ops] Is the control-plane running? Try: node apps/control-plane/index.js`);
    console.error(`[ops] Or set CONTROL_PLANE_BASE_URL in config/.env to the Cloud Run URL`);
  } else {
    console.error(`[ops] ${err.message}`);
  }
  process.exit(1);
}

module.exports = { get, post, print, handleError, BASE_URL };
