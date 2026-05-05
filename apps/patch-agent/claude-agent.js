"use strict";
/**
 * Claude-powered agentic loop that investigates an error incident,
 * reads repo files, and proposes a patch.
 *
 * Tools available to Claude:
 *   read_file       — read a source file
 *   list_directory  — list files under a directory
 *   search_code     — search codebase by keyword/pattern
 *   propose_patch   — final tool: specify file changes (terminates loop)
 */

const Anthropic = require("@anthropic-ai/sdk");

const MAX_ITERATIONS = 20;
const MODEL = "claude-opus-4-7";

const TOOLS = [
  {
    name: "read_file",
    description: "Read the full contents of a file in the repository.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to repo root, e.g. apps/voice-bridge/index.js" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List all file paths under a directory in the repository.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory path, e.g. apps/voice-bridge or configs/tenants" },
      },
      required: ["directory"],
    },
  },
  {
    name: "search_code",
    description: "Search for a keyword or pattern across all source files in the repository. Returns matching file paths.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term or pattern to find in the codebase" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_incidents",
    description: "Search the incident history database. Use this before proposing a fix to see if this error has occurred before, what was tried, whether fixes held, and what files were changed. Returns structured incident records.",
    input_schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Word or phrase to match against error messages and prior analyses — e.g. 'tenantLoader', 'Cannot read', 'sms_send_failed'",
        },
        service: {
          type: "string",
          description: "Filter to a specific service name, e.g. 'voice-bridge-service'. Omit to search across all services.",
        },
        status: {
          type: "string",
          description: "Filter by outcome: 'auto_deployed' (fix held?), 'patch_failed' (fix attempt broke?), 'patch_proposed' (pending review), 'investigated' (no fix found)",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 5, max 20.",
        },
      },
    },
  },
  {
    name: "propose_patch",
    description: "Propose code changes that fix the error. Call this when you have a complete, confident fix. This terminates the investigation.",
    input_schema: {
      type: "object",
      properties: {
        analysis: {
          type: "string",
          description: "Detailed root cause analysis of the error, including which code path caused it",
        },
        changes: {
          type: "array",
          description: "List of files to change. Maximum 5 files.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path relative to repo root" },
              content: { type: "string", description: "Complete new file content (not a diff — the full file)" },
              reason: { type: "string", description: "Why this file needs to change" },
            },
            required: ["path", "content", "reason"],
          },
        },
        test_suggestion: {
          type: "string",
          description: "How to verify the fix works (manual test steps or what to check in logs)",
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Risk assessment: low = isolated change, medium = affects shared code, high = core path change",
        },
        no_fix_reason: {
          type: "string",
          description: "If you cannot propose a safe code fix, explain why here and leave changes empty",
        },
      },
      required: ["analysis"],
    },
  },
];

async function analyzeAndPatch(incident, repoTree, githubOps) {
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are an autonomous error-fix agent for a production multitenant AI voice platform.

## Platform overview
- Node.js microservices on Google Cloud Run (europe-west1, project ldk-clean)
- voice-bridge-service: handles live WebSocket calls, bridges Telnyx ↔ OpenAI Realtime API (gpt-realtime-1.5)
- control-plane-service: operator API for tenant CRUD, logs, billing
- telephony-service: Telnyx webhook gateway, routes inbound calls
- post-processor-service: summarizes completed calls with gpt-4o-mini
- dashboard-service: Next.js + NextAuth customer dashboard
- Firestore: runtime tenant configs, call_sessions, incidents, suggestions
- Config source-of-truth: Git configs/tenants/*.json → published to Firestore

## Key files to know
- apps/voice-bridge/index.js — call handler, WebSocket, OpenAI session
- apps/voice-bridge/tenantLoader.js — loads tenant config from Firestore
- apps/voice-bridge/providers/FirestoreTenantProvider.js — Firestore reads
- apps/control-plane/index.js — Express app, mounts all routes
- apps/control-plane/routes/*.js — API routes
- configs/tenants/*.json — tenant configurations

## Your job
1. Read the incident details carefully
2. **First decide: is this a real bug or a transient/expected error?**
   - Transient: network timeouts, temporary OpenAI/Telnyx API blips, one-off cold-start issues
   - Real bug: code errors, null reference, missing config, logic flaw, repeated pattern
3. If transient: call propose_patch immediately with no changes and explain why in no_fix_reason
4. If real bug: investigate the relevant source files, trace the call path, propose a fix
5. Call propose_patch with your findings when confident

## Rules
- Read files before modifying them — never guess at file contents
- Fix only what caused this specific error — no refactoring
- If an error is in a shared utility, trace all callers before changing it
- Prefer adding null checks / guards over restructuring logic
- Never modify: cloudbuild*.yaml, Dockerfiles, package.json (unless dependency is the issue)
- If the fix requires a config change in configs/tenants/*.json, include it
- Maximum 5 files per patch
- If you genuinely cannot safely fix it, call propose_patch with no changes and explain why

## Available repo files
${repoTree.files.slice(0, 500).join("\n")}

## Incident history
You have a \`search_incidents\` tool. Use it before proposing any fix to check whether this error has occurred before, what was tried, and whether it held. Search by keyword from the error message, by file name, or by service. If a prior fix was auto-deployed and the error recurred, that fix failed — do not repeat it.`;

  const userMessage = `Investigate this production error and propose a fix.

**Service:** ${incident.service}
**Severity:** ${incident.severity}
**Timestamp:** ${incident.timestamp}
**Tenant:** ${incident.tenant_id || "unknown"}
**Trace ID:** ${incident.trace_id || "none"}

**Error message:**
\`\`\`
${incident.message}
\`\`\`

**AI pre-classification:**
- Category: ${incident.ai?.category || "unknown"}
- Summary: ${incident.ai?.summary || "—"}
- Likely cause: ${incident.ai?.likely_cause || "—"}
- Suggested fix: ${incident.ai?.suggested_fix || "—"}

Start by reading the most relevant source files, then trace the error to its root cause and propose a fix.`;

  const messages = [{ role: "user", content: userMessage }];
  let iterations = 0;
  let proposal = null;

  while (iterations < MAX_ITERATIONS && !proposal) {
    iterations++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: "assistant", content: response.content });

    // Check for tool use
    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      // Claude stopped without proposing — extract any text as the analysis
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      proposal = { analysis: text || "No analysis provided", changes: [], no_fix_reason: "Agent stopped without proposing a patch" };
      break;
    }

    // Process tool calls
    const toolResults = [];
    for (const toolUse of toolUses) {
      let result;
      try {
        if (toolUse.name === "read_file") {
          result = await githubOps.readFile(toolUse.input.path);
        } else if (toolUse.name === "list_directory") {
          const dir = toolUse.input.directory.replace(/\/$/, "");
          const matches = repoTree.files.filter((f) => f.startsWith(dir + "/"));
          result = matches.length > 0 ? matches.join("\n") : "(no files found)";
        } else if (toolUse.name === "search_code") {
          const hits = await githubOps.searchCode(toolUse.input.query);
          result = hits.length > 0
            ? hits.map((h) => `${h.path} (score: ${h.score})`).join("\n")
            : "(no results)";
        } else if (toolUse.name === "search_incidents") {
          const hits = await githubOps.searchIncidents(toolUse.input);
          result = hits.length > 0 ? hits.map(formatIncidentSummary).join("\n\n---\n\n") : "(no matching incidents found)";
        } else if (toolUse.name === "propose_patch") {
          proposal = toolUse.input;
          result = "Patch proposal recorded. Investigation complete.";
        }
      } catch (err) {
        result = `Error: ${err.message}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (proposal) break;
  }

  if (!proposal) {
    proposal = { analysis: "Max iterations reached without conclusion", changes: [], no_fix_reason: "Investigation exceeded iteration limit" };
  }

  return { proposal, iterations };
}

function formatIncidentSummary(h) {
  const ts = h.created_at?._seconds
    ? new Date(h.created_at._seconds * 1000).toISOString().slice(0, 16).replace("T", " ")
    : (h.timestamp || "?").slice(0, 16);
  const outcome = h.status === "auto_deployed"  ? "auto-deployed ✓"
                : h.status === "patch_proposed" ? "PR opened, awaiting review"
                : h.status === "patch_failed"   ? "patch job failed ✗"
                : h.status === "investigated"   ? "investigated, no fix applied"
                : h.status || "unknown";
  return [
    `ID: ${h.id}  |  ${ts}  |  ${h.service || "?"}  |  outcome: ${outcome}`,
    `Error: ${(h.message || "").split("\n")[0].slice(0, 250)}`,
    h.patch_analysis    ? `Analysis: ${h.patch_analysis.slice(0, 500)}`         : null,
    h.patch_files_changed ? `Files changed: ${h.patch_files_changed}`           : null,
    h.patch_risk        ? `Risk: ${h.patch_risk}`                                : null,
    h.patch_test_suggestion ? `Verification: ${h.patch_test_suggestion.slice(0, 200)}` : null,
    h.patch_no_fix_reason ? `No fix reason: ${h.patch_no_fix_reason.slice(0, 200)}`    : null,
  ].filter(Boolean).join("\n");
}

module.exports = { analyzeAndPatch };
