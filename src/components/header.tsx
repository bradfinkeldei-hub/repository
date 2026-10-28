import Link from "next/link";
import { signOut } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import type { Profile } from "@/lib/coaching";

export function Header({ me, sub, tabs, current, right }: {
  me: Pick<Profile, "name" | "avatar_url">;
  sub: string;
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="top">
      <div className="wrap bar">
        <Link href="/" className="brand">The Coaching Circle<small>{sub}</small></Link>
        <nav className="tabs" aria-label="Sections">
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
              {t.label}{t.count ? <span className="count">{t.count}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        {right}
        <Link className="linkbtn" href="/welcome">How it works</Link>
        <Link className="who-me" href="/profile" title="My profile" style={{ textDecoration: "none", fontWeight: 600 }}>
          <Avatar name={me.name} url={me.avatar_url} size={32} />My profile
        </Link>
        <Link className="linkbtn" href="/settings">Settings</Link>
        <form action={signOut}><button className="linkbtn" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
