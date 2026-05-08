"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { CallSuggestButton } from "./CallSuggestButton";

function tsValue(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}
function formatRelative(ts) {
  const v = tsValue(ts);
  if (!v) return "—";
  const d = new Date(v);
  const tz = { timeZone: "Europe/Stockholm" };
  const today = new Date(); today.setHours(0,0,0,0);
  if (d >= today) return `idag ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", ...tz })}`;
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= yesterday) return `igår ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", ...tz })}`;
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", ...tz });
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function CollapsibleCallEvent({ call, tenantId }) {
  const [open, setOpen] = useState(false);
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const preview = call.summary?.summary?.slice(0, 70);

  const callContext = {
    call_control_id: call.call_control_id,
    from_number: call.from_number,
    initiated_at: call.initiated_at?._seconds
      ? new Date(call.initiated_at._seconds * 1000).toISOString()
      : null,
    summary: call.summary?.summary?.slice(0, 200) || null,
  };

  return (
    <article className="bg-surface border border-line rounded-lg overflow-hidden">
      <header
        className="px-5 py-3 flex items-center justify-between bg-line-soft/40 cursor-pointer hover:bg-line-soft/60 transition-colors select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-accent-soft flex items-center justify-center text-accent flex-shrink-0">
            <Icon name="phone" size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">Samtal · {formatRelative(call.initiated_at)} · {formatDuration(call.duration_ms)}</div>
            {!open && preview && (
              <div className="text-xs text-muted truncate">{preview}{call.summary?.summary?.length > 70 ? "…" : ""}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-3" onClick={e => e.stopPropagation()}>
          <CallSuggestButton tenantId={tenantId} callContext={callContext} label="Förbättra agenten" />
          <Icon name="chevronDown" size={14} className={`text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </div>
      </header>

      {open && (
        <div className="p-5 space-y-4">
          {call.summary?.summary && (
            <p className="text-sm text-ink leading-relaxed">{call.summary.summary}</p>
          )}
          {transcript.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-2">
                Transkript · {transcript.length} repliker
              </div>
              <ol className="space-y-2 border-t border-line pt-3">
                {transcript.map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`uppercase text-[10px] font-semibold tracking-widest w-12 shrink-0 pt-1 ${t.role === "agent" ? "text-accent" : "text-muted"}`}>
                      {t.role === "agent" ? "Aila" : "Kund"}
                    </span>
                    <span className="text-ink leading-relaxed">{t.message || t.text || ""}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-xs text-subtle italic">Transkript saknas för detta samtal.</p>
          )}
          <Link
            href={`/calls/${encodeURIComponent(call.call_control_id)}`}
            className="text-xs text-accent hover:text-accent-hover font-medium inline-flex items-center gap-1"
          >
            Öppna fullständig samtalsvy <Icon name="arrowRight" size={11} />
          </Link>
        </div>
      )}
    </article>
  );
}
