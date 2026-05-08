"use client";
import { useState } from "react";

const MODELS = [
  { id: "gpt-realtime-1.5", label: "gpt-realtime-1.5", desc: "Stabil" },
  { id: "gpt-realtime-2",   label: "gpt-realtime-2",   desc: "BEST — 128K kontext, bättre instruktionsföljning, 20% billigare" },
];

export function ModelPicker({ tenantId, initialModel }) {
  const [model, setModel] = useState(initialModel || "gpt-realtime-1.5");
  const [status, setStatus] = useState(null);

  async function handleChange(e) {
    const newModel = e.target.value;
    setModel(newModel);
    setStatus("saving");
    try {
      const res = await fetch("/api/agent/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, model: newModel }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "Fel vid sparning");
      }
      setStatus("saved");
      setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus("error");
      setModel(initialModel);
    }
  }

  return (
    <div className="flex justify-between items-center py-2 border-b border-line last:border-0">
      <span className="text-xs text-muted">Realtime model</span>
      <div className="flex items-center gap-2">
        {status === "saving" && <span className="text-xs text-muted">Sparar…</span>}
        {status === "saved"  && <span className="text-xs text-success">Sparat</span>}
        {status === "error"  && <span className="text-xs text-error">Fel vid sparning</span>}
        <select
          value={model}
          onChange={handleChange}
          disabled={status === "saving"}
          className="text-sm text-ink mono bg-surface border border-line rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
