"use strict";
/**
 * apps/patch-agent/index.js
 *
 * Autonomous error-fix agent. Triggered by error-agent when an incident
 * is classified as actionable. Uses Claude (claude-opus-4-7) to:
 *   1. Read the full repo via GitHub API
 *   2. Investigate the error across all relevant files
 *   3. Propose a code fix
 *   4. Push a branch + open a GitHub PR
 *   5. Update the Firestore incident with the PR link
 *
 * Governance: never auto-merges. You review and merge → Cloud Build deploys.
 */

const express = require("express");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { getRepoTree, readFile, searchCode, pushBranchAndPR } = require("./github");
const { analyzeAndPatch } = require("./claude-agent");

const PORT = process.env.PORT || 8080;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const db = new Firestore({ projectId: PROJECT });
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "patch-agent",
    github: !!GITHUB_TOKEN,
    anthropic: !!ANTHROPIC_API_KEY,
  });
});

// Triggered by error-agent for actionable incidents
app.post("/patch", async (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) return res.status(400).json({ error: "incident_id required" });

  // Ack immediately — this job takes 30-120s
  res.status(202).json({ status: "accepted", incident_id });

  // Run asynchronously
  runPatchJob(incident_id).catch((err) => {
    console.error(`[patch-agent] Job failed for ${incident_id}:`, err.message);
  });
});

async function runPatchJob(incidentId) {
  console.log(`[patch-agent] Starting patch job for incident ${incidentId}`);

  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not configured");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  // 1. Load incident from Firestore
  const incidentRef = db.collection("incidents").doc(incidentId);
  const snap = await incidentRef.get();
  if (!snap.exists) throw new Error(`Incident ${incidentId} not found`);
  const incident = { id: incidentId, ...snap.data() };

  // Mark as being investigated
  await incidentRef.update({ status: "investigating", patch_started_at: FieldValue.serverTimestamp() });

  try {
    // 2. Get repo file tree
    console.log(`[patch-agent] Fetching repo tree...`);
    const repoTree = await getRepoTree(GITHUB_TOKEN);
    console.log(`[patch-agent] Repo has ${repoTree.files.length} files`);

    // 3. GitHub ops bound with token
    const githubOps = {
      readFile: (path) => readFile(GITHUB_TOKEN, path),
      searchCode: (query) => searchCode(GITHUB_TOKEN, query),
    };

    // 4. Run Claude agentic investigation
    console.log(`[patch-agent] Starting Claude investigation...`);
    const { proposal, iterations } = await analyzeAndPatch(incident, repoTree, githubOps);
    console.log(`[patch-agent] Investigation complete in ${iterations} iterations. Changes: ${proposal.changes?.length || 0}`);

    if (!proposal.changes?.length) {
      // No code fix possible — update incident with analysis only
      await incidentRef.update({
        status: "investigated",
        patch_result: "no_fix",
        patch_analysis: proposal.analysis,
        patch_no_fix_reason: proposal.no_fix_reason || "Agent determined no code change is needed",
        patch_iterations: iterations,
        patch_completed_at: FieldValue.serverTimestamp(),
      });
      console.log(`[patch-agent] No code fix proposed for ${incidentId}: ${proposal.no_fix_reason}`);
      return;
    }

    // 5. Push branch and open PR
    const branchName = `fix/auto-${incidentId.slice(0, 8)}-${Date.now().toString(36)}`;
    const filesChanged = proposal.changes.map((c) => c.path).join(", ");
    const prTitle = `[auto-patch] ${incident.ai?.summary || incident.service + " error fix"}`;

    const prBody = buildPrBody(incident, proposal, iterations);

    console.log(`[patch-agent] Pushing branch ${branchName} with ${proposal.changes.length} file(s)...`);
    const { prUrl, prNumber } = await pushBranchAndPR(GITHUB_TOKEN, {
      branchName,
      changes: proposal.changes,
      commitMessage: `fix: auto-patch for incident ${incidentId}\n\n${proposal.analysis.slice(0, 500)}`,
      prTitle,
      prBody,
    });

    console.log(`[patch-agent] PR created: ${prUrl}`);

    // 6. Update Firestore incident
    await incidentRef.update({
      status: "patch_proposed",
      patch_result: "pr_created",
      patch_pr_url: prUrl,
      patch_pr_number: prNumber,
      patch_branch: branchName,
      patch_files_changed: filesChanged,
      patch_analysis: proposal.analysis,
      patch_risk: proposal.risk || "unknown",
      patch_test_suggestion: proposal.test_suggestion || null,
      patch_iterations: iterations,
      patch_completed_at: FieldValue.serverTimestamp(),
    });

    console.log(`[patch-agent] Incident ${incidentId} updated with PR #${prNumber}`);
  } catch (err) {
    console.error(`[patch-agent] Error during patch job:`, err);
    await incidentRef.update({
      status: "patch_failed",
      patch_error: err.message,
      patch_completed_at: FieldValue.serverTimestamp(),
    }).catch(() => {});
    throw err;
  }
}

function buildPrBody(incident, proposal, iterations) {
  const lines = [
    `## 🤖 Automated patch — incident \`${incident.id}\``,
    ``,
    `**Service:** \`${incident.service}\`  `,
    `**Severity:** ${incident.severity}  `,
    `**Timestamp:** ${incident.timestamp}  `,
    `**Tenant:** ${incident.tenant_id || "—"}  `,
    `**Trace ID:** ${incident.trace_id || "—"}`,
    ``,
    `### Error`,
    `\`\`\``,
    (incident.message || "").slice(0, 1000),
    `\`\`\``,
    ``,
    `### Root cause analysis`,
    proposal.analysis,
    ``,
    `### Files changed`,
    ...(proposal.changes || []).map((c) => `- \`${c.path}\` — ${c.reason}`),
    ``,
    `### Risk`,
    `**${(proposal.risk || "unknown").toUpperCase()}**`,
    ``,
    `### How to verify`,
    proposal.test_suggestion || "Check Cloud Logging after merging — the error should stop recurring.",
    ``,
    `---`,
    `*Generated by patch-agent using claude-opus-4-7 in ${iterations} investigation steps.*`,
    `*Review carefully before merging. Merging triggers Cloud Build auto-deploy.*`,
  ];
  return lines.join("\n");
}

app.listen(PORT, () => {
  console.log(`[patch-agent] listening on port ${PORT}`);
  console.log(`[patch-agent] GitHub: ${GITHUB_TOKEN ? "configured" : "MISSING"}`);
  console.log(`[patch-agent] Anthropic: ${ANTHROPIC_API_KEY ? "configured" : "MISSING"}`);
});
