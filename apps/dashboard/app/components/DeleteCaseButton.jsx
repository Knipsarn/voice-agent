"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCaseButton({ caseId, backHref }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      router.push(backHref);
      router.refresh();
    } catch (err) {
      alert("Kunde inte radera: " + err.message);
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Är du säker?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-danger text-white hover:bg-danger/85 transition-colors disabled:opacity-50"
        >
          {deleting ? "Raderar…" : "Ja, radera"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-muted hover:text-ink px-2 py-1.5"
        >
          Avbryt
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-muted hover:text-danger transition-colors px-2 py-1.5 rounded-lg hover:bg-danger/5 border border-transparent hover:border-danger/20"
    >
      Radera ärende
    </button>
  );
}
