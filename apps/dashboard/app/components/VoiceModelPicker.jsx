"use client";
import { useState } from "react";

const REASONING_LEVELS = [
  { id: "minimal", label: "Minimal", latency: "~1.1s" },
  { id: "low",     label: "Low",     latency: "~1.4s" },
  { id: "medium",  label: "Medium",  latency: "~1.8s" },
  { id: "high",    label: "High",    latency: "~2.1s" },
  { id: "xhigh",   label: "Max",     latency: "~2.3s" },
];

const MODELS = [
  { id: "gpt-realtime-1.5", label: "gpt-realtime-1.5", tags: [] },
  { id: "gpt-realtime-2",   label: "gpt-realtime-2",   tags: ["BEST", "SMARTER"] },
];

// Two providers: OpenAI (Marin/Cedar) and xAI Grok (eve/ara/rex/sal/leo).
// The voice-bridge derives which realtime API to use from the voice ID — picking
// a Grok voice automatically routes the call to xAI's realtime endpoint.
const VOICES_BY_MODEL = {
  "gpt-realtime-1.5": [
    { id: "marin",   label: "Marin",   desc: "Professionell, tydlig (OpenAI)",  tags: ["OPENAI"] },
    { id: "cedar",   label: "Cedar",   desc: "Naturlig, konversativ (OpenAI)",  tags: ["OPENAI"] },
    { id: "eve",     label: "Eve",     desc: "Kvinnlig, energisk (Grok)",       tags: ["GROK"] },
    { id: "ara",     label: "Ara",     desc: "Kvinnlig, varm (Grok)",           tags: ["GROK"] },
    { id: "rex",     label: "Rex",     desc: "Manlig, tydlig (Grok)",           tags: ["GROK"] },
    { id: "sal",     label: "Sal",     desc: "Neutral, balanserad (Grok)",      tags: ["GROK"] },
    { id: "leo",     label: "Leo",     desc: "Manlig, auktoritär (Grok)",       tags: ["GROK"] },
  ],
  "gpt-realtime-2": [
    { id: "marin",   label: "Marin",   desc: "Professionell, tydlig (OpenAI)",  tags: ["OPENAI", "REC"] },
    { id: "cedar",   label: "Cedar",   desc: "Naturlig, konversativ (OpenAI)",  tags: ["OPENAI"] },
    { id: "eve",     label: "Eve",     desc: "Kvinnlig, energisk (Grok)",       tags: ["GROK"] },
    { id: "ara",     label: "Ara",     desc: "Kvinnlig, varm (Grok)",           tags: ["GROK"] },
    { id: "rex",     label: "Rex",     desc: "Manlig, tydlig (Grok)",           tags: ["GROK"] },
    { id: "sal",     label: "Sal",     desc: "Neutral, balanserad (Grok)",      tags: ["GROK"] },
    { id: "leo",     label: "Leo",     desc: "Manlig, auktoritär (Grok)",       tags: ["GROK"] },
  ],
};

async function save(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Fel"); }
}

export function VoiceModelPicker({ tenantId, initialModel, initialVoice, initialReasoning, isAdmin }) {
  const resolvedModel = initialModel || "gpt-realtime-1.5";
  const [model, setModel] = useState(resolvedModel);
  const [voice, setVoice] = useState(initialVoice || "marin");
  const [reasoning, setReasoning] = useState(initialReasoning || "minimal");
  const [status, setStatus] = useState(null);

  const availableVoices = VOICES_BY_MODEL[model] ?? VOICES_BY_MODEL["gpt-realtime-1.5"];
  const activeVoice = availableVoices.some(v => v.id === voice) ? voice : availableVoices[0]?.id;

  function flash(result) {
    setStatus(result);
    if (result === "saved") setTimeout(() => setStatus(null), 2000);
  }

  async function handleModelChange(newModel) {
    if (!isAdmin || newModel === model) return;
    const voices = VOICES_BY_MODEL[newModel] ?? [];
    const newVoice = voices.some(v => v.id === voice) ? voice : voices[0]?.id;
    setModel(newModel);
    if (newVoice !== voice) setVoice(newVoice);
    setStatus("saving");
    try {
      await save("/api/agent/model", { tenant_id: tenantId, model: newModel });
      if (newVoice !== voice) await save("/api/agent/voice", { tenant_id: tenantId, voice: newVoice });
      flash("saved");
    } catch {
      setModel(resolvedModel);
      setVoice(initialVoice);
      flash("error");
    }
  }

  async function handleReasoningChange(newReasoning) {
    if (newReasoning === reasoning) return;
    setReasoning(newReasoning);
    setStatus("saving");
    try {
      await save("/api/agent/reasoning", { tenant_id: tenantId, reasoning_effort: newReasoning });
      flash("saved");
    } catch {
      setReasoning(reasoning);
      flash("error");
    }
  }

  async function handleVoiceChange(e) {
    const newVoice = e.target.value;
    setVoice(newVoice);
    setStatus("saving");
    try {
      await save("/api/agent/voice", { tenant_id: tenantId, voice: newVoice });
      flash("saved");
    } catch {
      setVoice(activeVoice);
      flash("error");
    }
  }

  return (
    <div>
      {/* Header with autosave indicator */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted">Ändringar sparas automatiskt och gäller från nästa samtal.</p>
        <span className={`text-xs transition-opacity ${status === "saving" ? "text-muted opacity-100" : status === "saved" ? "text-success opacity-100" : status === "error" ? "text-error opacity-100" : "opacity-0"}`}>
          {status === "saving" ? "Sparar…" : status === "saved" ? "✓ Sparat" : "Fel vid sparning"}
        </span>
      </div>

      {/* Step 1: Model */}
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-2">1 · Modell</p>
        <div className="flex gap-2">
          {MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => handleModelChange(m.id)}
              disabled={!isAdmin || status === "saving"}
              className={`flex-1 flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-all ${
                model === m.id
                  ? "border-accent bg-accent/5 shadow-sm"
                  : isAdmin
                    ? "border-line hover:border-accent/50 hover:bg-surface-raised"
                    : "border-line opacity-50 cursor-not-allowed"
              }`}
            >
              <span className="text-sm font-medium text-ink mono">{m.label}</span>
              {m.tags.length > 0 && (
                <div className="flex gap-1 mt-1.5">
                  {m.tags.map(tag => (
                    <span key={tag} className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-accent text-white">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
        {!isAdmin && <p className="text-xs text-muted mt-2">Modellval kräver adminbehörighet.</p>}
      </div>

      {/* Step 2: Voice */}
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-2">2 · Röst</p>
        <select
          value={activeVoice}
          onChange={handleVoiceChange}
          disabled={status === "saving"}
          className="w-full text-sm text-ink bg-surface border border-line rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
        >
          {availableVoices.map(v => (
            <option key={v.id} value={v.id}>
              {v.label}{v.tags?.length ? ` · ${v.tags.join(" · ")}` : ""} — {v.desc}
            </option>
          ))}
        </select>
      </div>

      {/* Step 3: Reasoning effort — gpt-realtime-2 only */}
      {model === "gpt-realtime-2" && isAdmin && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-2">3 · Reasoning effort</p>
          <div className="flex gap-1.5">
            {REASONING_LEVELS.map(level => (
              <button
                key={level.id}
                onClick={() => handleReasoningChange(level.id)}
                disabled={status === "saving"}
                className={`flex-1 flex flex-col items-center px-2 py-2.5 rounded-lg border text-center transition-all ${
                  reasoning === level.id
                    ? "border-accent bg-accent/5"
                    : "border-line hover:border-accent/50"
                }`}
              >
                <span className="text-xs font-medium text-ink">{level.label}</span>
                <span className="text-[10px] text-muted mt-0.5 mono">{level.latency}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">Svarstid till första ljud. För en receptionist rekommenderas Minimal eller Low.</p>
        </div>
      )}
    </div>
  );
}
