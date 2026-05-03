"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Icon } from "./Icon";

/**
 * Click the funnel icon → checkbox dropdown of statuses.
 * Selected statuses are written to ?status=a,b,c on the URL.
 * Empty / all selected = no filter (treated as "all").
 */
export function StatusFilterMenu({ options, defaultSelected }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const fromUrl = (searchParams.get("status") || "").split(",").map(s => s.trim()).filter(Boolean);
  const initial = fromUrl.length > 0 ? fromUrl : (defaultSelected ?? options.map(o => o.key));
  const [selected, setSelected] = useState(new Set(initial));

  // close on outside click
  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    const all = selected.size === 0 || selected.size === options.length;
    if (all) {
      params.delete("status");
    } else {
      params.set("status", [...selected].join(","));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  function reset() {
    setSelected(new Set(options.map(o => o.key)));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  const filterActive = fromUrl.length > 0 && fromUrl.length < options.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 text-sm font-medium border rounded-md px-3 py-1.5 transition-colors ${
          filterActive
            ? "bg-accent-soft text-accent border-accent/30"
            : "bg-surface text-muted border-line hover:text-ink hover:border-line-strong"
        }`}
        aria-label="Filtrera"
      >
        <FilterIcon />
        <span>Filter</span>
        {filterActive && <span className="text-xs tabular">({fromUrl.length})</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-line rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="p-3 space-y-2">
            {options.map((opt) => {
              const checked = selected.has(opt.key);
              return (
                <label key={opt.key} className="flex items-center gap-2.5 cursor-pointer text-sm py-1 hover:bg-line-soft/40 rounded px-1.5 -mx-1.5">
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? "bg-accent border-accent text-white" : "border-line"}`}
                  >
                    {checked && (
                      <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
                    )}
                  </span>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(opt.key)} />
                  {opt.dotCls && <span className={`w-1.5 h-1.5 rounded-full ${opt.dotCls}`} />}
                  <span className="text-ink flex-1">{opt.label}</span>
                  {typeof opt.count === "number" && (
                    <span className="text-xs text-subtle tabular">{opt.count}</span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="border-t border-line p-2 flex items-center justify-between gap-2">
            <button type="button" onClick={reset} className="text-xs text-muted hover:text-ink px-2 py-1.5">
              Återställ
            </button>
            <button type="button" onClick={apply} className="text-xs font-semibold bg-ink text-white px-3 py-1.5 rounded-md hover:bg-ink/85">
              Tillämpa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
