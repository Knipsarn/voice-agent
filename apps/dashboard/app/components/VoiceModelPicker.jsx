"use client";
import { useState } from "react";

const MODELS = [
  { id: "gpt-realtime-1.5", label: "gpt-realtime-1.5", badge: null,     desc: "Stabil" },
  { id: "gpt-realtime-2",   label: "gpt-realtime-2",   badge: "BEST",   desc: "128K kontext · bättre instruktionsföljning · 20% billigare" },
];

const VOICES_BY_MODEL = {
  "gpt-realtime-1.5": [
    { id: "alloy",   label: "Alloy",   desc: "Neutral, balanserad" },
    { id: "ash",     label: "Ash",     desc: "Tydlig, precis" },
    { id: "ballad",  label: "Ballad",  desc: "Melodisk, mjuk" },
    { id: "coral",   label: "Coral",   desc: "Varm, vänlig" },
    { id: "echo",    label: "Echo",    desc: "Resonant, djup" },
    { id: "sage",    label: "Sage",    desc: "Lugn, genomtänkt" },
    { id: "shimmer", label: "Shimmer", desc: "Ljus, energisk" },
    { id: "verse",   label: "Verse",   desc: "Mångsidig, uttrycksfull" },
  ],
  "gpt-realtime-2": [
    { id: "alloy",   label: "Alloy",   desc: "Neutral, balanserad" },
    { id: "ash",     label: "Ash",     desc: "Tydlig, precis" },
    { id: "ballad",  label: "Ballad",  desc: "Melodisk, mjuk" },
    { id: "cedar",   label: "Cedar",   desc: "Naturlig, konversativ · ny" },
    { id: "coral",   label: "Coral",   desc: "Varm, vänlig" },
    { id: "echo",    label: "Echo",    desc: "Resonant, djup" },
    { id: "marin",   label: "Marin",   desc: "Professionell, tydlig · rekommenderad" },
    { id: "sage",    label: "Sage",    desc: "Lugn, genomtänkt" },
    { id: "shimmer", label: "Shimmer", desc: "Ljus, energisk" },
    { id: "verse",   label: "Verse",   desc: "Mångsidig, uttrycksfull" },
  ],
};

async function saveModel(tenantId, model) {
  const res = await fetch("/api/agent/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, model }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Fel"); }
}

async function saveVoice(tenantId, voice) {
  const res = await fetch("/api/agent/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, voice }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Fel"); }
}

export function VoiceModelPicker({ tenantId, initialModel, initialVoice, isAdmin }) {
  const [model, setModel]         = useState(initialModel || "gpt-realtime-1.5");
  const [voice, setVoice]         = useState(initialVoice || "marin");
  const [modelStatus, setModelStatus] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState(null);

  const availableVoices = VOICES_BY_MODEL[model] || VOICES_BY_MODEL["gpt-realtime-1.5"];
  const voiceValid = availableVoices.some(v => v.id === voice);

  async function handleModelChange(e) {
    const newModel = e.target.value;
    const voices = VOICES_BY_MODEL[newModel] || [];
    const newVoice = voices.some(v => v.id === voice) ? voice : voices[0]?.id;

    setModel(newModel);
    setModelStatus("saving");
    if (newVoice !== voice) setVoice(newVoice);

    try {
      await saveModel(tenantId, newModel);
      if (newVoice !== voice) await saveVoice(tenantId, newVoice);
      setModelStatus("saved");
      setTimeout(() => setModelStatus(null), 2000);
    } catch {
      setModel(initialModel);
      setVoice(initialVoice);
      setModelStatus("error");
    }
  }

  async function handleVoiceChange(e) {
    const newVoice = e.target.value;
    setVoice(newVoice);
    setVoiceStatus("saving");
    try {
      await saveVoice(tenantId, newVoice);
      setVoiceStatus("saved");
      setTimeout(() => setVoiceStatus(null), 2000);
    } catch {
      setVoice(voice);
      setVoiceStatus("error");
    }
  }

  return (
    <div className="space-y-0">
      {/* Step 1: Model */}
      <div className="py-3 border-b border-line">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-accent mr-1.5">1</span>
            Modell
          </span>
          {modelStatus === "saving" && <span className="text-xs text-muted">Sparar…</span>}
          {modelStatus === "saved"  && <span className="text-xs text-success">Sparat</span>}
          {modelStatus === "error"  && <span className="text-xs text-error">Fel vid sparning</span>}
        </div>
        <div className="flex flex-col gap-2">
          {MODELS.map(m => (
            <label
              key={m.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                model === m.id
                  ? "border-accent bg-accent/5"
                  : "border-line hover:border-accent/40"
              } ${(!isAdmin || modelStatus === "saving") ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="model"
                value={m.id}
                checked={model === m.id}
                onChange={isAdmin ? handleModelChange : undefined}
                disabled={!isAdmin || modelStatus === "saving"}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink mono">{m.label}</span>
                  {m.badge && (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-accent text-white">
                      {m.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted mt-0.5">{m.desc}</p>
              </div>
            </label>
          ))}
        </div>
        {!isAdmin && (
          <p className="text-xs text-muted mt-2">Modellval kräver adminbehörighet.</p>
        )}
      </div>

      {/* Step 2: Voice */}
      <div className="py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-accent mr-1.5">2</span>
            Röst
          </span>
          {voiceStatus === "saving" && <span className="text-xs text-muted">Sparar…</span>}
          {voiceStatus === "saved"  && <span className="text-xs text-success">Sparat</span>}
          {voiceStatus === "error"  && <span className="text-xs text-error">Fel vid sparning</span>}
        </div>
        <select
          value={voiceValid ? voice : availableVoices[0]?.id}
          onChange={handleVoiceChange}
          disabled={voiceStatus === "saving"}
          className="w-full text-sm text-ink mono bg-surface border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {availableVoices.map(v => (
            <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
