/**
 * ticket-agent.js
 *
 * Claude-powered agent that processes tenant support tickets.
 * Reads current tenant state, determines risk level, and applies
 * safe changes autonomously. High-risk or dashboard changes require human.
 *
 * Returns: { risk_level, analysis, actions_taken, needs_human, agent_response }
 */

const Anthropic = require("@anthropic-ai/sdk");
const { Firestore } = require("@google-cloud/firestore");

const db = new Firestore();
const TENANTS = "tenants";

const ALLOWED_VOICES    = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"];
const ALLOWED_MODELS    = ["gpt-realtime-1.5", "gpt-realtime-2"];
const ALLOWED_REASONING = ["minimal", "low", "medium", "high", "xhigh"];

// ── Tool implementations ──────────────────────────────────────────────────────

async function readTenantConfig({ tenant_id }) {
  const doc = await db.collection(TENANTS).doc(tenant_id).get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  const d = doc.data();
  // Return a safe subset — omit raw instruction text to save tokens
  return JSON.stringify({
    tenant_id: d.tenant_id,
    company_name: d.company_name,
    voice: d.voice,
    realtime_model: d.realtime_model,
    reasoning_effort: d.reasoning_effort,
    default_language: d.default_language,
    entry_mode: d.entry_mode,
    status: d.status,
    first_message: d.first_message,
    _meta: d._meta,
  });
}

async function readPrompt({ tenant_id }) {
  const doc = await db.collection(TENANTS).doc(tenant_id).get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  const d = doc.data();
  return JSON.stringify({
    instructions_base: d.instructions?.base?.slice(0, 2000) + (d.instructions?.base?.length > 2000 ? "…[truncated]" : ""),
    default_mode: d.instructions?.default_mode,
    modes: Object.fromEntries(
      Object.entries(d.modes || {}).map(([k, v]) => [k, { label: v.label, instructions_preview: v.instructions?.slice(0, 300) }])
    ),
    first_message: d.first_message,
  });
}

async function patchVoice({ tenant_id, voice }) {
  if (!ALLOWED_VOICES.includes(voice)) throw new Error(`Invalid voice: ${voice}. Allowed: ${ALLOWED_VOICES.join(", ")}`);
  const ref = db.collection(TENANTS).doc(tenant_id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  await ref.set({ voice, _meta: { ...doc.data()._meta, voice_updated_at: new Date().toISOString(), voice_updated_source: "ticket_agent" } }, { merge: true });
  return JSON.stringify({ ok: true, voice });
}

async function patchModel({ tenant_id, model }) {
  if (!ALLOWED_MODELS.includes(model)) throw new Error(`Invalid model: ${model}. Allowed: ${ALLOWED_MODELS.join(", ")}`);
  const ref = db.collection(TENANTS).doc(tenant_id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  await ref.set({ realtime_model: model, _meta: { ...doc.data()._meta, model_updated_at: new Date().toISOString(), model_updated_source: "ticket_agent" } }, { merge: true });
  return JSON.stringify({ ok: true, model });
}

async function patchReasoning({ tenant_id, reasoning_effort }) {
  if (!ALLOWED_REASONING.includes(reasoning_effort)) throw new Error(`Invalid reasoning_effort: ${reasoning_effort}. Allowed: ${ALLOWED_REASONING.join(", ")}`);
  const ref = db.collection(TENANTS).doc(tenant_id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  await ref.set({ reasoning_effort, _meta: { ...doc.data()._meta, reasoning_updated_at: new Date().toISOString(), reasoning_updated_source: "ticket_agent" } }, { merge: true });
  return JSON.stringify({ ok: true, reasoning_effort });
}

// Sections the agent is NEVER allowed to auto-apply.
// base = core personality/intake flow. modes = workflow routing.
// Humans must review these — one bad suggestion chain can break the agent.
const LOCKED_SECTIONS = new Set(["base"]);
function isModeSection(section) { return section.startsWith("mode."); }

async function patchPrompt({ tenant_id, section, content, reason }) {
  if (!section || !content) throw new Error("section and content required");

  // Safety lock: refuse to write to protected sections
  if (LOCKED_SECTIONS.has(section) || isModeSection(section)) {
    throw new Error(
      `Section '${section}' is safety-locked. Only first_message and knowledge.* can be auto-applied. ` +
      `For base/mode changes, set risk_level=high and needs_human=true in your result.`
    );
  }

  const ref = db.collection(TENANTS).doc(tenant_id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`Tenant not found: ${tenant_id}`);
  const data = doc.data();

  const update = {};
  if (section === "first_message") {
    update["first_message"] = content;
  } else if (section.startsWith("knowledge.")) {
    const blockName = section.replace(/^knowledge\./, "");
    update[`knowledge_blocks.${blockName}`] = content;
  } else {
    throw new Error(
      `Unknown section '${section}'. Auto-appliable: first_message, knowledge.<name>. ` +
      `Locked (needs human): base, mode.<name>.`
    );
  }

  await ref.update(update);
  console.log(JSON.stringify({ event: "ticket_agent_patch_prompt", tenant_id, section, reason }));
  return JSON.stringify({ ok: true, section, reason });
}

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: "read_tenant_config",
    description: "Read the tenant's current configuration (voice, model, reasoning, status, language). Always call this first.",
    input_schema: {
      type: "object",
      properties: { tenant_id: { type: "string" } },
      required: ["tenant_id"],
    },
  },
  {
    name: "read_prompt",
    description: "Read the tenant's current prompt instructions, modes, and first message. Call this for prompt/ai_info category tickets.",
    input_schema: {
      type: "object",
      properties: { tenant_id: { type: "string" } },
      required: ["tenant_id"],
    },
  },
  {
    name: "patch_voice",
    description: "Update the agent voice. Use for 'call' category tickets requesting a voice change.",
    input_schema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        voice: { type: "string", enum: ALLOWED_VOICES },
      },
      required: ["tenant_id", "voice"],
    },
  },
  {
    name: "patch_model",
    description: "Update the realtime model (gpt-realtime-1.5 or gpt-realtime-2). Use for 'call' category tickets.",
    input_schema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        model: { type: "string", enum: ALLOWED_MODELS },
      },
      required: ["tenant_id", "model"],
    },
  },
  {
    name: "patch_reasoning",
    description: "Update the reasoning effort level. Use for 'call' category tickets requesting smarter or faster responses.",
    input_schema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        reasoning_effort: { type: "string", enum: ALLOWED_REASONING },
      },
      required: ["tenant_id", "reasoning_effort"],
    },
  },
  {
    name: "patch_prompt",
    description: "Update a prompt section (base instructions, first_message, a workflow mode, or a knowledge block). Use for 'prompt' and 'ai_info' category tickets.",
    input_schema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        section: { type: "string", description: "base | first_message | mode.<name> | knowledge.<name>" },
        content: { type: "string", description: "The new full content for this section" },
        reason: { type: "string", description: "Brief explanation of what changed and why" },
      },
      required: ["tenant_id", "section", "content", "reason"],
    },
  },
];

const TOOL_FNS = {
  read_tenant_config: readTenantConfig,
  read_prompt:        readPrompt,
  patch_voice:        patchVoice,
  patch_model:        patchModel,
  patch_reasoning:    patchReasoning,
  patch_prompt:       patchPrompt,
};

// ── System prompt (stable — cached) ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous AI agent for the Finnai AI voice platform. Your role is to process support tickets submitted by tenants (customers) and either resolve them directly or escalate them to a human developer.

## Platform context
- Multi-tenant AI voice platform: callers dial a phone number, an AI agent answers using OpenAI Realtime API
- Each tenant has: voice, model, reasoning_effort, prompt instructions, workflow modes, knowledge blocks
- Changes to Firestore take effect on the next call — no redeploy needed for config changes
- Code changes (dashboard, infrastructure) require a human developer and git push

## Ticket categories and your authority

**prompt** — Changes to what the AI says, its personality, its knowledge, its intake flow

SAFETY ZONES (you MUST respect these — the tool will reject violations):
- 🔒 LOCKED (never auto-apply, always needs_human=true): base instructions, workflow modes (mode.*)
  These define core personality and intake flow. One bad change can break all calls.
- ✅ OPEN (safe to auto-apply): first_message, knowledge.* blocks
  Low blast radius — greetings and factual info.

If a ticket requests changes to a locked section: set risk_level=high, needs_human=true,
and write agent_response explaining what a human developer should do.

If a ticket was submitted with a call_context (from a specific call): ALWAYS needs_human=true.
One call is not enough evidence to change agent behavior — this needs human judgment.

→ You CAN auto-apply: first_message and knowledge.* changes (if no call_context)
→ You MUST escalate: base, modes, anything with call_context

**call** — Changes to voice, model, reasoning speed/quality
- Low risk: changing voice, changing reasoning_effort
- Medium risk: changing from gpt-realtime-1.5 to gpt-realtime-2 (or back)
- High risk: none — all call config changes are safe for you to apply
→ You CAN apply all call config changes

**ai_info** — Updates to knowledge blocks (what the AI knows about the business)
- Low risk: adding/updating factual information, fixing wrong facts
- Medium risk: restructuring knowledge blocks
→ You CAN apply low/medium risk ai_info changes

**dashboard** — Requests about the Finnai dashboard UI or features
- Always HIGH risk — requires code changes
→ You CANNOT apply these. Describe what needs to be done.

**other** — Anything else
- Default to HIGH risk unless it clearly fits the above
→ Escalate with a clear description

## Risk levels
- **low**: Direct, narrow change with no unintended side effects. Apply automatically.
- **medium**: Meaningful change that could affect call quality. Apply but flag prominently.
- **high**: Structural change, code change, or anything uncertain. Do NOT apply — describe what a human should do.

## Your output format
After taking any actions, your FINAL message must be a valid JSON object (and nothing else):
{
  "risk_level": "low" | "medium" | "high",
  "analysis": "What the ticket is about in 1-2 sentences",
  "actions_taken": ["list of changes applied, empty if none"],
  "needs_human": true | false,
  "agent_response": "Message to show the tenant explaining what was done or what will happen"
}`;

// ── Main export ───────────────────────────────────────────────────────────────

async function processTicket({ tenant_id, ticket_id, text, category, has_call_context }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      risk_level: "high",
      analysis: "Ticket agent not configured (missing ANTHROPIC_API_KEY).",
      actions_taken: [],
      needs_human: true,
      agent_response: "Din förfrågan har registrerats och granskas av teamet.",
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages = [
    {
      role: "user",
      content: `Process this support ticket for tenant "${tenant_id}".

Category: ${category}
Submitted from a specific call: ${has_call_context ? "YES — treat as needs_human=true regardless of risk level" : "no"}
Ticket text: ${text}

Start by reading the tenant config, then analyze the ticket and take appropriate action. End your response with the JSON result object.`,
    },
  ];

  const actionsTaken = [];
  let attempts = 0;
  const MAX_ITERATIONS = 10;

  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: TOOL_DEFS,
    messages,
  });

  // Agentic tool loop
  while (response.stop_reason === "tool_use" && attempts < MAX_ITERATIONS) {
    attempts++;
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        const fn = TOOL_FNS[block.name];
        if (!fn) throw new Error(`Unknown tool: ${block.name}`);
        result = await fn(block.input);
        if (block.name.startsWith("patch_")) {
          actionsTaken.push(`${block.name}(${JSON.stringify(block.input)})`);
        }
      } catch (err) {
        result = JSON.stringify({ error: err.message });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOL_DEFS,
      messages,
    });
  }

  // Parse the final JSON result from the last text block
  const textBlock = response.content.find(b => b.type === "text");
  if (textBlock) {
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Merge any actions we tracked ourselves
        if (actionsTaken.length > 0 && parsed.actions_taken?.length === 0) {
          parsed.actions_taken = actionsTaken;
        }
        return parsed;
      }
    } catch (_) { /* fall through */ }
  }

  // Fallback if parsing failed
  return {
    risk_level: "medium",
    analysis: "Ticket processed but result could not be parsed.",
    actions_taken: actionsTaken,
    needs_human: actionsTaken.length === 0,
    agent_response: "Din förfrågan har registrerats. Teamet återkommer.",
  };
}

module.exports = { processTicket };
