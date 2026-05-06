"use client";

import { useState } from "react";

const SECTION_LABELS = {
  "instructions.base": "Huvudprompt (System Prompt)",
  "knowledge_blocks.category_policies": "Kategorihantering",
  "knowledge_blocks.guardrails": "Ton & gränser",
};

function PromptSection({ tenantId, sectionKey, label, content, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/prompt", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, section: sectionKey, content: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(content || "");
    setEditing(false);
    setError(null);
  }

  return (
    <div className="bg-surface border border-line rounded-lg p-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <h2 className="text-xs uppercase tracking-widest text-muted font-semibold">{label}</h2>
        {isAdmin && !editing && (
          <button
            onClick={() => { setEditing(true); setDraft(content || ""); }}
            className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-ink transition-colors shrink-0"
          >
            Edit
          </button>
        )}
        {saved && (
          <span className="text-xs text-success font-medium shrink-0">Saved</span>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full font-mono text-xs text-ink bg-canvas border border-line rounded-md p-3 resize-y min-h-48 max-h-96 focus:outline-none focus:ring-1 focus:ring-accent/60"
            spellCheck={false}
          />
          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-ink text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
            >
              {saving ? "Sparar..." : "Spara"}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-line text-muted hover:text-ink hover:border-ink transition-colors disabled:opacity-50"
            >
              Avbryt
            </button>
          </div>
          <p className="text-[10px] text-subtle">
            Hotfix — skriv direkt till Firestore. Backa till Git inom 24h.
          </p>
        </div>
      ) : (
        <pre className="font-mono text-xs text-ink bg-canvas border border-line rounded-md p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words">
          {content || <span className="text-subtle italic">(empty)</span>}
        </pre>
      )}
    </div>
  );
}

export function PromptEditor({ tenantId, sections, isAdmin }) {
  return (
    <div className="space-y-6">
      {SECTION_LABELS &&
        Object.entries(SECTION_LABELS).map(([key, label]) => (
          <PromptSection
            key={key}
            tenantId={tenantId}
            sectionKey={key}
            label={label}
            content={sections?.[key]}
            isAdmin={isAdmin}
          />
        ))}
    </div>
  );
}
