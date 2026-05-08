"use client";
import { useState } from "react";
import { SuggestionPanel } from "./SuggestionPanel";
import { Icon } from "./Icon";

export function CallSuggestButton({ tenantId, callContext, label, category, variant = "default" }) {
  const [open, setOpen] = useState(false);

  const resolvedCategory = category || (callContext ? "prompt" : "other");

  const btnCls = variant === "ghost"
    ? "inline-flex items-center gap-1.5 text-muted hover:text-ink transition-colors px-2 py-1 rounded text-xs font-medium hover:bg-line-soft"
    : "inline-flex items-center gap-2 bg-ink text-white hover:bg-ink/85 transition-colors px-3 py-1.5 rounded-md text-xs font-medium";

  return (
    <>
      <button onClick={() => setOpen(true)} className={btnCls}>
        <Icon name="sparkles" size={12} />
        {label || (callContext ? "Förbättra agentsvaret" : "Föreslå förbättring")}
      </button>
      <SuggestionPanel
        open={open}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        callContext={callContext}
        category={resolvedCategory}
      />
    </>
  );
}
