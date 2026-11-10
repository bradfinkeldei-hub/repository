"use client";

import { useEffect, useState } from "react";

/**
 * The group's cards, three across on a wide screen. Full shows every card whole;
 * Compact shows just who and their focus, and tapping a card opens it in place.
 * The choice is remembered in this browser.
 */
export function BoardView({ children }: { children: React.ReactNode }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try { setCompact(localStorage.getItem("board-layout") === "compact"); } catch { /* private mode */ }
  }, []);
  function pick(c: boolean) {
    setCompact(c);
    try { localStorage.setItem("board-layout", c ? "compact" : "full"); } catch { /* private mode */ }
  }
  function open(e: React.MouseEvent<HTMLDivElement>) {
    if (!compact) return;
    const t = e.target as HTMLElement;
    const card = t.closest(".focus-card");
    if (!card || card.classList.contains("open")) return;
    if (t.closest("a, button, input, select, textarea, summary, label, form")) return;
    card.classList.add("open");
  }
  return (
    <>
      <div className="board-switch" role="group" aria-label="Card layout">
        <button type="button" aria-pressed={!compact} onClick={() => pick(false)}>Full cards</button>
        <button type="button" aria-pressed={compact} onClick={() => pick(true)}>Compact</button>
      </div>
      <div className={`grid board${compact ? " compact" : ""}`} onClick={open}>{children}</div>
    </>
  );
}
