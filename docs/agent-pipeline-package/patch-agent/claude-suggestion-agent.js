"use strict";
/**
 * Claude-powered agentic loop that processes a prompt improvement suggestion.
 *
 * Reads the tenant's current prompt files and config, interprets what the
 * customer/operator wants to change, and proposes targeted edits.
 *
 * Tools:
 *   read_file            — read any repo file
 *   list_directory       — list files under a directory
 *   propose_prompt_change — final tool: specify prompt file changes (terminates loop)
 */

const Anthropic = require("@anthropic-ai/sdk");

const MAX_ITERATIONS = 15;
const MODEL = "claude-opus-4-7";

const TOOLS = [
  {
    name: "read_file",
    description: "Read the full contents of a file in the repository.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to repo root, e.g. configs/prompt-assets/enkla-juridik/main.md" },
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
        directory: { type: "string", description: "Directory path, e.g. configs/prompt-assets/enkla-juridik" },
      },
      required: ["directory"],
    },
  },
  {
    name: "propose_prompt_change",
    description: "Propose changes to prompt files or tenant config. Call this when you have a targeted, well-reasoned change ready. This terminates the loop.",
    input_schema: {
      type: "object",
      properties: {
        analysis: {
          type: "string",
          description: "What the customer/operator wanted and why these specific changes address it",
        },
        changes: {
          type: "array",
          description: "Files to change. Only configs/tenants/ or configs/prompt-assets/ paths allowed.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path relative to repo root" },
              content: { type: "string", description: "Complete new file content (not a diff)" },
              reason: { type: "string", description: "What specifically changed and why" },
            },
            required: ["path", "content", "reason"],
          },
        },
        no_change_reason: {
          type: "string",
          description: "If no change is appropriate (vague request, risky edit, no clear improvement), explain here and leave changes empty",
        },
      },
      required: ["analysis"],
    },
  },
];

async function analyzeAndPatchSuggestion(suggestion, repoTree, githubOps) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tenantId = suggestion.tenantId || suggestion.tenant_id;

  const systemPrompt = `You are an AI agent that improves prompt configurations for a multitenant AI voice receptionist platform running in production.

## Platform context
- AI receptionists answer phone calls for businesses
- Each tenant has a config file: configs/tenants/<tenant-id>.json
- Prompt files live in: configs/prompt-assets/<tenant-id>/*.md
- Tenant configs reference prompt files via "$file:" pointers
- Voice matters: prompts must sound natural spoken aloud, not like written text
- The AI uses OpenAI Realtime API — short, clear instructions work best

## Tenant: ${tenantId}

## Your job
1. Read configs/tenants/${tenantId}.json to understand the tenant setup
2. Read the relevant prompt files in configs/prompt-assets/${tenantId}/
3. Understand exactly what the suggestion is asking for
4. Make a targeted, minimal change that addresses the request
5. Call propose_prompt_change with your changes

## Hard rules
- Only modify files in configs/tenants/ or configs/prompt-assets/
- Never touch code files (apps/*, *.js, *.jsx, *.ts, Dockerfiles, *.yaml)
- Never change tenant_id, voice, language, or audio settings
- Read files before editing them — never guess at content
- If the suggestion is too vague, contradictory, or risky -> use no_change_reason instead
- Maximum 3 files per change

## Available repo files
${repoTree.files.filter((f) => f.startsWith("configs/")).join("\n")}`;

  const callContext = suggestion.call_context
    ? `\n\n**Call context:**\n- From: ${suggestion.call_context.from_number || "?"}\n- At: ${suggestion.call_context.initiated_at || "?"}\n- Summary: ${suggestion.call_context.summary || "(none)"}`
    : "";

  const userMessage = `A suggestion has been submitted for the AI receptionist of tenant "${tenantId}".

**Suggestion:**
${suggestion.text}

**Submitted by:** ${suggestion.submitted_by || "customer"}${callContext}

Read the current prompt configuration, understand the request, and propose the appropriate changes.`;

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

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      proposal = { analysis: text || "No analysis provided", changes: [], no_change_reason: "Agent stopped without proposing a change" };
      break;
    }

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
        } else if (toolUse.name === "propose_prompt_change") {
          proposal = toolUse.input;
          result = "Prompt change proposal recorded. Investigation complete.";
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
    proposal = { analysis: "Max iterations reached without conclusion", changes: [], no_change_reason: "Investigation exceeded iteration limit" };
  }

  return { proposal, iterations };
}

module.exports = { analyzeAndPatchSuggestion };
