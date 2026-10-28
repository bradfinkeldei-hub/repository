"use client";

import { useEffect } from "react";

// A page opened before an update can't run the new version's buttons (Next
// reports "Server Action ... was not found"). Reloading once picks up the
// new version; anything else gets a friendly page instead of a blank error.
const KEY = "reloaded-after-error";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = /server action/i.test(error.message);
  useEffect(() => {
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {}
    window.location.reload();
  }, [stale]);

  return (
    <div className="wrap" style={{ paddingBlock: "64px" }}>
      <div className="empty">
        <h2>{stale ? "The app was just updated" : "Something went wrong"}</h2>
        <p>{stale ? "Reload the page to get the latest version, then try again." : "Try again. If it keeps happening, reload the page."}</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn" type="button" onClick={() => window.location.reload()}>Reload the page</button>
          {!stale && <button className="btn ghost" type="button" onClick={reset}>Try again</button>}
        </div>
      </div>
    </div>
  );
}
