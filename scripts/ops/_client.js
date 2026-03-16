/**
 * scripts/ops/_client.js
 *
 * Shared HTTP client for operator shell scripts.
 * Reads CONTROL_PLANE_BASE_URL and CONTROL_PLANE_API_KEY from env or config/.env.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

const BASE_URL = process.env.CONTROL_PLANE_BASE_URL || "http://localhost:4000";
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

module.exports = { get, post, print, BASE_URL };
