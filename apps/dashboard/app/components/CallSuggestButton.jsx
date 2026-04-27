"use client";
import { useState } from "react";
import { SuggestionPanel } from "./SuggestionPanel";

export function CallSuggestButton({ tenantId, callContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-accent-soft text-accent hover:bg-accent hover:text-white transition-all px-4 py-2 rounded-xl text-sm font-medium"
      >
        <span>✨</span>
        Föreslå förbättring för det här samtalet
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
