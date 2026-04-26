// JSON-line logger — Cloud Logging ingests as jsonPayload (queryable per field).
function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function logError(event, fields = {}) {
  console.error(JSON.stringify({ event, severity: "ERROR", ...fields }));
}

module.exports = { log, logError };
