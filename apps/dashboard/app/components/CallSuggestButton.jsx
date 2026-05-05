"use client";
import { useState } from "react";
import { SuggestionPanel } from "./SuggestionPanel";
import { Icon } from "./Icon";

export function CallSuggestButton({ tenantId, callContext, label }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-ink text-white hover:bg-ink/85 transition-colors px-3 py-1.5 rounded-md text-xs font-medium"
      >
        <Icon name="sparkles" size={12} />
        {label || "Föreslå förbättring"}
      </button>
      <SuggestionPanel
        open={open}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        callContext={callContext}
      />
    </>
  );
}
