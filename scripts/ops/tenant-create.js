/**
 * ops/tenant-create.js — Scaffold a new tenant
 *
 * Creates configs/tenants/<id>.json and configs/prompt-assets/<id>/ with
 * template prompt files, then runs --dry-run publish to validate.
 *
 * Usage:
 *   node scripts/ops/tenant-create.js <tenantId> --company="Company Name" \
 *     [--voice=marin] [--language=sv-SE] [--entry-mode=direct_to_gpt] \
 *     [--phone=+46700000000]
 *
 * After scaffolding:
 *   1. Edit configs/prompt-assets/<id>/*.md — fill in the [TODO] sections
 *   2. node scripts/ops/tenant-diff.js <id>
 *   3. node scripts/ops/tenant-publish.js <id>
 */

const fs   = require("fs");
const path = require("path");

const args     = process.argv.slice(2);
const tenantId = args.find(a => !a.startsWith("--"));
const company  = (args.find(a => a.startsWith("--company="))     || "").split("=").slice(1).join("=") || null;
const voice    = (args.find(a => a.startsWith("--voice="))       || "").split("=")[1] || "marin";
const language = (args.find(a => a.startsWith("--language="))    || "").split("=")[1] || "sv-SE";
const entryMode= (args.find(a => a.startsWith("--entry-mode="))  || "").split("=")[1] || "direct_to_gpt";
const phone    = (args.find(a => a.startsWith("--phone="))       || "").split("=")[1] || "+46700000000";

if (!tenantId || !company) {
  console.error('Usage: node scripts/ops/tenant-create.js <tenantId> --company="Company Name" [--voice=marin] [--language=sv-SE] [--entry-mode=direct_to_gpt] [--phone=+46...]');
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(tenantId)) {
  console.error("tenantId must be lowercase alphanumeric + hyphens only (e.g. my-company)");
  process.exit(1);
}

const ROOT         = path.join(__dirname, "../..");
const configPath   = path.join(ROOT, "configs/tenants", `${tenantId}.json`);
const assetsDir    = path.join(ROOT, "configs/prompt-assets", tenantId);

if (fs.existsSync(configPath)) {
  console.error(`[tenant-create] configs/tenants/${tenantId}.json already exists. Aborting.`);
  process.exit(1);
}
if (fs.existsSync(assetsDir)) {
  console.error(`[tenant-create] configs/prompt-assets/${tenantId}/ already exists. Aborting.`);
  process.exit(1);
}

// ── 1. Tenant config JSON ─────────────────────────────────────────────────────

const transcriptionLanguage = language.split("-")[0]; // "sv-SE" -> "sv"

const config = {
  tenant_id: tenantId,
  status: "draft",
  company_name: company,
  default_language: language,
  voice,
  realtime_model: "gpt-realtime-1.5",
  transcription_language: transcriptionLanguage,
  entry_mode: entryMode,
  first_message_enabled: true,
  first_message: `Hej och välkommen till ${company}. Berätta gärna vad du behöver hjälp med.`,
  instructions: {
    base: `$file:configs/prompt-assets/${tenantId}/main-prompt.md`,
    default_mode: "INTAKE"
  },
  modes: {
    INTAKE: {
      label: "Ärendeintag",
      instructions: `$file:configs/prompt-assets/${tenantId}/intake-mode.md`,
      unlock_blocks: ["guardrails"]
    }
  },
  knowledge_blocks: {
    guardrails: `$file:configs/prompt-assets/${tenantId}/guardrails.md`
  },
  phone_numbers: {
    primary_e164: phone
  },
  pbx: {
    enabled: entryMode === "pbx_first",
    ai_option_digit: entryMode === "pbx_first" ? "1" : null,
    voicemail_option_digit: null
  },
  features: {
    direct_to_gpt: entryMode === "direct_to_gpt",
    barge_in: true,
    mode_switching: false
  }
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(`[tenant-create] ✓ Created configs/tenants/${tenantId}.json`);

// ── 2. Prompt asset scaffolds ─────────────────────────────────────────────────

fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, "main-prompt.md"), `\
# ${company} — AI Phone Agent

Du är en AI-telefonagent för ${company}. Din uppgift är att [TODO: beskriv agentens roll].

## Identitet
- Du heter [TODO: agentens namn, t.ex. "Maja"]
- Du pratar svenska i en professionell och vänlig ton
- Du representerar ${company}

## Ditt ansvar
[TODO: lista huvuduppgifter, t.ex.:
- Ta emot ärenden från kunder
- Svara på vanliga frågor om tjänsten
- Samla in nödvändig information]

## Vad du inte kan hjälpa med
[TODO: lista saker utanför scope, t.ex.:
- Fakturaärenden
- Teknisk support]

## Om du inte kan hjälpa
Säg: "[TODO: hänvisningstext, t.ex. 'Jag kopplar dig till en kollega som kan hjälpa dig bättre.']"

## Ton och stil
- Kortfattad och tydlig
- Aldrig avbryt kunden i onödan
- Bekräfta vad kunden sa innan du svarar
`);
console.log(`[tenant-create] ✓ Created configs/prompt-assets/${tenantId}/main-prompt.md`);

fs.writeFileSync(path.join(assetsDir, "intake-mode.md"), `\
# Ärendeintag — Riktlinjer

Ditt mål i INTAKE-läget är att [TODO: beskriv intag-målet, t.ex. "förstå kundens ärende och samla in nödvändig information"].

## Steg
1. Hälsa kunden välkommen (görs automatiskt via first_message)
2. Lyssna på kundens ärende
3. [TODO: lägg till steg]

## Information att samla in
- [TODO: fält 1, t.ex. kundens namn]
- [TODO: fält 2, t.ex. ärendetyp]
- [TODO: fält 3]

## Avslut
När ärendet är klart, säg: "[TODO: avslutningsfras]"
`);
console.log(`[tenant-create] ✓ Created configs/prompt-assets/${tenantId}/intake-mode.md`);

fs.writeFileSync(path.join(assetsDir, "guardrails.md"), `\
# Guardrails och ton

## Alltid
- Var ärlig om att du är en AI om kunden frågar
- Håll dig till ${company}s verksamhetsområde
- Avsluta artigt om kunden är otrevlig

## Aldrig
- Lova saker du inte kan hålla
- Ge juridisk, medicinsk eller finansiell rådgivning
- Dela information om andra kunder eller interna system
- [TODO: lägg till branschspecifika guardrails]
`);
console.log(`[tenant-create] ✓ Created configs/prompt-assets/${tenantId}/guardrails.md`);

// ── 3. Local validation ───────────────────────────────────────────────────────

console.log("\n[tenant-create] Validating...");

const REQUIRED_FIELDS = ["tenant_id", "status", "company_name", "voice", "entry_mode", "instructions"];
const errors = [];
const warnings = [];

for (const f of REQUIRED_FIELDS) {
  if (!config[f]) errors.push(`Missing required field: ${f}`);
}

// Resolve and check all $file: references
function findFileRefs(obj) {
  if (typeof obj === "string" && obj.startsWith("$file:")) return [obj.slice(6)];
  if (typeof obj === "object" && obj !== null) return Object.values(obj).flatMap(findFileRefs);
  return [];
}

for (const ref of findFileRefs(config)) {
  const refPath = path.join(ROOT, ref);
  if (!fs.existsSync(refPath)) {
    errors.push(`$file: reference not found: ${ref}`);
  } else {
    const content = fs.readFileSync(refPath, "utf8").trim();
    if (content.length < 20) warnings.push(`${ref} looks very short — remember to fill in the [TODO] sections`);
  }
}

if (errors.length) {
  console.error("\n[tenant-create] Validation errors:");
  errors.forEach(e => console.error(`  ✗ ${e}`));
} else {
  console.log("[tenant-create] ✓ Validation passed");
}
if (warnings.length) {
  warnings.forEach(w => console.warn(`  ⚠ ${w}`));
}

// ── 4. Next steps ─────────────────────────────────────────────────────────────

console.log(`
────────────────────────────────────────────────────
  Tenant ${tenantId} scaffolded. Next steps:

  1. Fill in the [TODO] sections:
       configs/prompt-assets/${tenantId}/main-prompt.md
       configs/prompt-assets/${tenantId}/intake-mode.md
       configs/prompt-assets/${tenantId}/guardrails.md

  2. Review the config:
       configs/tenants/${tenantId}.json

  3. Start control-plane locally (reads new files from disk):
       node apps/control-plane/index.js

  4. In another terminal — validate + publish:
       node scripts/ops/tenant-publish.js ${tenantId} --dry-run --local
       node scripts/ops/tenant-publish.js ${tenantId} --local

  5. Verify (uses live Cloud Run — no --local needed):
       node scripts/ops/tenant-meta.js ${tenantId}
────────────────────────────────────────────────────
`);
