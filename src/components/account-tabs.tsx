import Link from "next/link";

/** Switches between "My profile" (what your team sees) and "Settings" (just for you). */
export function AccountTabs({ current, back }: { current: "profile" | "settings"; back: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
      <Link href={back} className="linkbtn">← Back</Link>
      <nav className="tabs" aria-label="Your account">
        <Link href="/profile" aria-current={current === "profile" ? "page" : undefined}>My profile</Link>
        <Link href="/settings" aria-current={current === "settings" ? "page" : undefined}>Settings</Link>
      </nav>
    </div>
  );
}
