"use client";
import { useState } from "react";

const VOICES = [
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
];

export function VoicePicker({ tenantId, initialVoice }) {
  const [voice, setVoice] = useState(initialVoice || "marin");
  const [status, setStatus] = useState(null); // null | "saving" | "saved" | "error"

  async function handleChange(e) {
    const newVoice = e.target.value;
    setVoice(newVoice);
    setStatus("saving");
    try {
      const res = await fetch("/api/agent/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, voice: newVoice }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || "Fel vid sparning");
      }
      setStatus("saved");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus("error");
      setVoice(initialVoice); // revert
    }
  }

  return (
    <div className="flex justify-between items-center py-2 border-b border-line last:border-0">
      <span className="text-xs text-muted">Röst</span>
      <div className="flex items-center gap-2">
        {status === "saving" && <span className="text-xs text-muted">Sparar…</span>}
        {status === "saved"  && <span className="text-xs text-success">Sparat</span>}
        {status === "error"  && <span className="text-xs text-error">Fel vid sparning</span>}
        <select
          value={voice}
          onChange={handleChange}
          disabled={status === "saving"}
          className="text-sm text-ink mono bg-surface border border-line rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} — {v.desc}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
