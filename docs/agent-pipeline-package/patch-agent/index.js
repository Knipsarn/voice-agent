"use strict";
/**
 * apps/patch-agent/index.js
 *
 * Two autonomous jobs:
 *
 * 1. Error patch — POST /patch
 *    Triggered by error-agent when an incident is classified as actionable.
 *    Uses Claude to investigate, propose a fix, push a branch, open a PR.
 *    LOW risk → squash-merges automatically → Cloud Build deploys.
 *    MEDIUM/HIGH risk → PR opened, email sent for manual review.
 *
 * 2. Prompt suggestion — POST /process-suggestions
 *    Triggered by Cloud Scheduler (every 2h). Picks up new prompt_suggestions
 *    from Firestore, uses Claude to read prompt files and propose targeted edits,
 *    opens a PR, and emails Nils for manual review + merge.
 */

const express = require("express");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { getRepoTree, readFile, searchCode, pushBranchAndPR, mergePR } = require("./github");
const { analyzeAndPatch } = require("./claude-agent");
const { analyzeAndPatchSuggestion } = require("./claude-suggestion-agent");

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || "nils.wahlin@snmintegrations.se";
const ALERT_FROM  = process.env.ALERT_FROM_EMAIL         || "Voice Platform <noreply@snmintegrations.se>";

async function sendPatchAlert({ subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn("[patch-agent] No RESEND_API_KEY — alert not sent"); return; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM, to: [ADMIN_EMAIL], subject, text }),
    });
    if (!res.ok) console.error("[patch-agent] alert send failed:", res.status, await res.text().catch(() => ""));
    else console.log(`[patch-agent] alert sent: ${subject}`);
  } catch (err) {
    console.error("[patch-agent] alert send error:", err.message);
  }
}

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

// ── POST /patch ───────────────────────────────────────────────────────────────
// Triggered by error-agent for actionable incidents
app.post("/patch", async (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) return res.status(400).json({ error: "incident_id required" });

  res.status(202).json({ status: "accepted", incident_id });

  runPatchJob(incident_id).catch((err) => {
    console.error(`[patch-agent] Job failed for ${incident_id}:`, err.message);
  });
});

// ── POST /process-suggestions ─────────────────────────────────────────────────
// Triggered by Cloud Scheduler every 2h. Picks up new prompt suggestions.
app.post("/process-suggestions", async (req, res) => {
  if (!GITHUB_TOKEN)      return res.status(500).json({ error: "GITHUB_TOKEN not configured" });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  res.status(202).json({ status: "accepted" });

  runSuggestionBatch().catch((err) => {
    console.error("[patch-agent] Suggestion batch failed:", err.message);
  });
});

// ── Incident history search (called as a Claude tool) ────────────────────────
// Queries Firestore for past incidents matching service/keyword/status.
// Returns structured records so Claude can decide what's relevant — not pre-dumped.
async function searchIncidentHistory({ keyword, service, status, limit = 5 } = {}, excludeId = null) {
  const cap = Math.min(Number(limit) || 5, 20);

  // Fetch a window; Firestore lacks full-text so we filter in memory
  let q = db.collection("incidents").orderBy("created_at", "desc");
  if (service) q = q.where("service", "==", service);
  if (status)  q = q.where("status", "==", status);
  // Fetch wider window so keyword filtering still returns enough results
  q = q.limit(cap * 10);

  const snap = await q.get();
  let results = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((h) => h.id !== excludeId)
    // Only return incidents that were actually investigated (have useful data)
    .filter((h) => h.patch_analysis || h.patch_result || h.patch_no_fix_reason || h.message);

  if (keyword) {
    const kw = keyword.toLowerCase();
    results = results.filter((h) =>
      (h.message         || "").toLowerCase().includes(kw) ||
      (h.patch_analysis  || "").toLowerCase().includes(kw) ||
      (h.patch_files_changed || "").toLowerCase().includes(kw) ||
      (h.patch_no_fix_reason || "").toLowerCase().includes(kw)
    );
  }

  return results.slice(0, cap);
}

// ── Error patch job ───────────────────────────────────────────────────────────
async function runPatchJob(incidentId) {
  console.log(`[patch-agent] Starting patch job for incident ${incidentId}`);

  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not configured");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const incidentRef = db.collection("incidents").doc(incidentId);
  const snap = await incidentRef.get();
  if (!snap.exists) throw new Error(`Incident ${incidentId} not found`);
  const incident = { id: incidentId, ...snap.data() };

  await incidentRef.update({ status: "investigating", patch_started_at: FieldValue.serverTimestamp() });

  try {
    console.log(`[patch-agent] Fetching repo tree...`);
    const repoTree = await getRepoTree(GITHUB_TOKEN);
    console.log(`[patch-agent] Repo has ${repoTree.files.length} files`);

    const githubOps = {
      readFile:      (path)  => readFile(GITHUB_TOKEN, path),
      searchCode:    (query) => searchCode(GITHUB_TOKEN, query),
      searchIncidents: (opts) => searchIncidentHistory(opts, incidentId),
    };

    console.log(`[patch-agent] Starting Claude investigation...`);
    const { proposal, iterations } = await analyzeAndPatch(incident, repoTree, githubOps);
    console.log(`[patch-agent] Investigation complete in ${iterations} iterations. Changes: ${proposal.changes?.length || 0}`);

    if (!proposal.changes?.length) {
      await incidentRef.update({
        status: "investigated",
        patch_result: "no_fix",
        patch_analysis: proposal.analysis,
        patch_no_fix_reason: proposal.no_fix_reason || "Agent determined no code change is needed",
        patch_iterations: iterations,
        patch_completed_at: FieldValue.serverTimestamp(),
      });

      await sendPatchAlert({
        subject: `[Voice Platform] Error needs attention: ${incident.service}`,
        text: [
          `Incident ${incidentId} was investigated but no automatic fix is possible.`,
          "",
          `Service:  ${incident.service}`,
          `Severity: ${incident.severity}`,
          `Error:    ${(incident.message || "").slice(0, 300)}`,
          "",
          `Analysis: ${(proposal.analysis || "").slice(0, 800)}`,
          "",
          `Reason no fix: ${proposal.no_fix_reason || "unknown"}`,
          "",
          "Action required — review and fix manually.",
        ].join("\n"),
      });
      return;
    }

    // Push branch + open PR
    const branchName = `fix/auto-${incidentId.slice(0, 8)}-${Date.now().toString(36)}`;
    const prTitle    = `[auto-patch] ${incident.ai?.summary || incident.service + " error fix"}`;
    const prBody     = buildPrBody(incident, proposal, iterations);

    console.log(`[patch-agent] Pushing branch ${branchName}...`);
    const { prUrl, prNumber } = await pushBranchAndPR(GITHUB_TOKEN, {
      branchName,
      changes: proposal.changes,
      commitMessage: `fix: auto-patch for incident ${incidentId}\n\n${proposal.analysis.slice(0, 500)}`,
      prTitle,
      prBody,
    });

    const risk       = proposal.risk || "unknown";
    const autoMerge  = risk === "low";
    const filesChanged = proposal.changes.map((c) => c.path).join(", ");

    if (autoMerge) {
      // LOW risk — squash-merge immediately, Cloud Build deploys
      console.log(`[patch-agent] Low-risk fix — auto-merging PR #${prNumber}...`);
      await mergePR(GITHUB_TOKEN, prNumber, {
        commitTitle:   `fix: auto-patch for incident ${incidentId} [auto-merged]`,
        commitMessage: proposal.analysis.slice(0, 500),
      });
      console.log(`[patch-agent] PR #${prNumber} merged. Cloud Build will deploy.`);

      await incidentRef.update({
        status:                "auto_deployed",
        patch_result:          "auto_merged",
        patch_pr_url:          prUrl,
        patch_pr_number:       prNumber,
        patch_branch:          branchName,
        patch_files_changed:   filesChanged,
        patch_analysis:        proposal.analysis,
        patch_risk:            risk,
        patch_test_suggestion: proposal.test_suggestion || null,
        patch_iterations:      iterations,
        patch_completed_at:    FieldValue.serverTimestamp(),
      });

      await sendPatchAlert({
        subject: `[Voice Platform] Auto-fix deployed: ${incident.service}`,
        text: [
          `Patch-agent automatically fixed and deployed a solution for incident ${incidentId}.`,
          "",
          `Service:  ${incident.service}`,
          `Severity: ${incident.severity}`,
          `Error:    ${(incident.message || "").slice(0, 300)}`,
          "",
          `PR:       ${prUrl} (auto-merged)`,
          `Files:    ${filesChanged}`,
          "",
          `Analysis: ${(proposal.analysis || "").slice(0, 600)}`,
          "",
          `How to verify: ${proposal.test_suggestion || "Check Cloud Logging — the error should stop recurring."}`,
          "",
          "Cloud Build is deploying the fix now. No action needed.",
        ].join("\n"),
      });
    } else {
      // MEDIUM / HIGH risk — PR open, manual review required
      console.log(`[patch-agent] ${risk.toUpperCase()} risk — PR created for manual review: ${prUrl}`);

      await incidentRef.update({
        status:                "patch_proposed",
        patch_result:          "pr_created",
        patch_pr_url:          prUrl,
        patch_pr_number:       prNumber,
        patch_branch:          branchName,
        patch_files_changed:   filesChanged,
        patch_analysis:        proposal.analysis,
        patch_risk:            risk,
        patch_test_suggestion: proposal.test_suggestion || null,
        patch_iterations:      iterations,
        patch_completed_at:    FieldValue.serverTimestamp(),
      });

      await sendPatchAlert({
        subject: `[Voice Platform] Auto-fix ready for review (${risk} risk): ${incident.service}`,
        text: [
          `Patch-agent has proposed a fix for incident ${incidentId}.`,
          `Risk is ${risk.toUpperCase()} — manual review required before deploy.`,
          "",
          `Service:  ${incident.service}`,
          `Severity: ${incident.severity}`,
          `Error:    ${(incident.message || "").slice(0, 300)}`,
          "",
          `PR:       ${prUrl}`,
          `Risk:     ${risk}`,
          `Files:    ${filesChanged}`,
          "",
          `Analysis: ${(proposal.analysis || "").slice(0, 600)}`,
          "",
          "Review and merge the PR — Cloud Build will deploy automatically.",
        ].join("\n"),
      });
    }
  } catch (err) {
    console.error(`[patch-agent] Error during patch job:`, err);
    await incidentRef.update({
      status:                "patch_failed",
      patch_error:           err.message,
      patch_completed_at:    FieldValue.serverTimestamp(),
    }).catch(() => {});
    throw err;
  }
}

// ── Suggestion batch job ──────────────────────────────────────────────────────
async function runSuggestionBatch() {
  console.log("[patch-agent] Starting suggestion batch...");

  const snap = await db
    .collection("prompt_suggestions")
    .where("status", "==", "new")
    .orderBy("created_at", "asc")
    .limit(5)
    .get();

  if (snap.empty) {
    console.log("[patch-agent] No new suggestions.");
    return;
  }

  console.log(`[patch-agent] Found ${snap.size} new suggestion(s).`);

  const repoTree = await getRepoTree(GITHUB_TOKEN);
  const githubOps = {
    readFile:   (path)  => readFile(GITHUB_TOKEN, path),
    searchCode: (query) => searchCode(GITHUB_TOKEN, query),
  };

  for (const doc of snap.docs) {
    const suggestion = { id: doc.id, ...doc.data() };
    await runSuggestionJob(suggestion, doc.ref, repoTree, githubOps);
  }
}

async function runSuggestionJob(suggestion, docRef, repoTree, githubOps) {
  console.log(`[patch-agent] Processing suggestion ${suggestion.id} for ${suggestion.tenantId}`);

  await docRef.update({ status: "processing", processing_started_at: FieldValue.serverTimestamp() });

  try {
    const { proposal, iterations } = await analyzeAndPatchSuggestion(suggestion, repoTree, githubOps);
    console.log(`[patch-agent] Suggestion ${suggestion.id} complete in ${iterations} iterations. Changes: ${proposal.changes?.length || 0}`);

    if (!proposal.changes?.length) {
      await docRef.update({
        status:            "no_change",
        patch_analysis:    proposal.analysis,
        no_change_reason:  proposal.no_change_reason || "Agent determined no change is needed",
        patch_iterations:  iterations,
        patch_completed_at: FieldValue.serverTimestamp(),
      });

      await sendPatchAlert({
        subject: `[Voice Platform] Prompt suggestion reviewed — no change needed`,
        text: [
          `Suggestion ${suggestion.id} from ${suggestion.submitted_by || "customer"} was reviewed.`,
          "",
          `Tenant: ${suggestion.tenantId}`,
          `Suggestion: ${(suggestion.text || "").slice(0, 300)}`,
          "",
          `Analysis: ${(proposal.analysis || "").slice(0, 600)}`,
          "",
          `Reason no change: ${proposal.no_change_reason || "unknown"}`,
        ].join("\n"),
      });
      return;
    }

    const branchName   = `prompt/suggest-${suggestion.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const filesChanged = proposal.changes.map((c) => c.path).join(", ");
    const prTitle      = `[prompt-suggestion] ${suggestion.tenantId}: ${(suggestion.text || "").slice(0, 60)}`;
    const prBody       = buildSuggestionPrBody(suggestion, proposal, iterations);

    console.log(`[patch-agent] Pushing suggestion branch ${branchName}...`);
    const { prUrl, prNumber } = await pushBranchAndPR(GITHUB_TOKEN, {
      branchName,
      changes: proposal.changes,
      commitMessage: `prompt: suggestion ${suggestion.id} for ${suggestion.tenantId}\n\n${proposal.analysis.slice(0, 400)}`,
      prTitle,
      prBody,
    });

    console.log(`[patch-agent] Suggestion PR created: ${prUrl}`);

    await docRef.update({
      status:             "pr_created",
      patch_pr_url:       prUrl,
      patch_pr_number:    prNumber,
      patch_branch:       branchName,
      patch_files_changed: filesChanged,
      patch_analysis:     proposal.analysis,
      patch_iterations:   iterations,
      patch_completed_at: FieldValue.serverTimestamp(),
    });

    await sendPatchAlert({
      subject: `[Voice Platform] Prompt suggestion ready for review — ${suggestion.tenantId}`,
      text: [
        `A prompt improvement suggestion has been processed for ${suggestion.tenantId}.`,
        "",
        `Submitted by: ${suggestion.submitted_by || "customer"}`,
        `Suggestion:   ${(suggestion.text || "").slice(0, 300)}`,
        "",
        `PR:    ${prUrl}`,
        `Files: ${filesChanged}`,
        "",
        `Analysis: ${(proposal.analysis || "").slice(0, 600)}`,
        "",
        "Review and merge the PR — Cloud Build will publish the updated prompt automatically.",
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[patch-agent] Suggestion job failed for ${suggestion.id}:`, err.message);
    await docRef.update({
      status:             "failed",
      patch_error:        err.message,
      patch_completed_at: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
}

// ── PR body builders ──────────────────────────────────────────────────────────
function buildPrBody(incident, proposal, iterations) {
  const autoMerged = (proposal.risk || "unknown") === "low";
  return [
    `## Automated patch — incident \`${incident.id}\``,
    ``,
    `**Service:** \`${incident.service}\`  `,
    `**Severity:** ${incident.severity}  `,
    `**Timestamp:** ${incident.timestamp}  `,
    `**Tenant:** ${incident.tenant_id || "—"}  `,
    `**Risk:** **${(proposal.risk || "unknown").toUpperCase()}**${autoMerged ? " — auto-merged" : ""}`,
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
    `### How to verify`,
    proposal.test_suggestion || "Check Cloud Logging after deploying — the error should stop recurring.",
    ``,
    `---`,
    `*Generated by patch-agent using claude-opus-4-7 in ${iterations} investigation steps.*`,
  ].join("\n");
}

function buildSuggestionPrBody(suggestion, proposal, iterations) {
  return [
    `## Prompt suggestion — \`${suggestion.tenantId}\``,
    ``,
    `**Submitted by:** ${suggestion.submitted_by || "customer"}  `,
    `**Suggestion ID:** \`${suggestion.id}\`  `,
    ``,
    `### Suggestion`,
    `> ${(suggestion.text || "").replace(/\n/g, "\n> ")}`,
    ``,
    ...(suggestion.call_context ? [
      `### Call context`,
      `- From: ${suggestion.call_context.from_number || "?"}`,
      `- At: ${suggestion.call_context.initiated_at || "?"}`,
      `- Summary: ${suggestion.call_context.summary || "(none)"}`,
      ``,
    ] : []),
    `### What changed`,
    proposal.analysis,
    ``,
    `### Files changed`,
    ...(proposal.changes || []).map((c) => `- \`${c.path}\` — ${c.reason}`),
    ``,
    `---`,
    `*Generated by patch-agent using claude-opus-4-7 in ${iterations} steps.*`,
    `*Merge to publish — Cloud Build will deploy the updated prompt automatically.*`,
  ].join("\n");
}

app.listen(PORT, () => {
  console.log(`[patch-agent] listening on port ${PORT}`);
  console.log(`[patch-agent] GitHub: ${GITHUB_TOKEN ? "configured" : "MISSING"}`);
  console.log(`[patch-agent] Anthropic: ${ANTHROPIC_API_KEY ? "configured" : "MISSING"}`);
});
