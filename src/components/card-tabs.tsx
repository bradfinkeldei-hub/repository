"use client";

import { useId, useState } from "react";

/** Tabs across the top of a member card. Every panel is rendered; only the chosen one shows. */
export function CardTabs({ tabs, children, className = "card-tabs", label }: { tabs: { key: string; label: string; dot?: boolean; title?: string }[]; children: React.ReactNode[]; className?: string; label?: string }) {
  const [on, setOn] = useState(0);
  const id = useId();
  return (
    <>
      <div className={className} role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" id={`${id}-t${i}`} aria-controls={`${id}-p${i}`} aria-selected={on === i}
            tabIndex={on === i ? 0 : -1} title={t.title} onClick={() => setOn(i)}
            onKeyDown={(e) => {
              const n = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : -1;
              if (n < 0) return;
              setOn(n);
              document.getElementById(`${id}-t${n}`)?.focus();
            }}>
            {t.label}{t.dot && <i className="tab-dot" aria-label=" (still to fill in)" />}
          </button>
        ))}
      </div>
      {children.map((c, i) => (
        <div key={tabs[i]?.key ?? i} role="tabpanel" id={`${id}-p${i}`} aria-labelledby={`${id}-t${i}`} hidden={on !== i} className="card-panel">{c}</div>
      ))}
    </>
  );
}
