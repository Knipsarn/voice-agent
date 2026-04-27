"use client";
import { useState } from "react";
import { SuggestionPanel } from "./SuggestionPanel";
import { Icon } from "./Icon";

export function CallSuggestButton({ tenantId, callContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-ink text-white hover:bg-ink/85 transition-colors px-4 py-2 rounded-md text-sm font-medium"
      >
        <Icon name="sparkles" size={14} />
        Föreslå förbättring
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
