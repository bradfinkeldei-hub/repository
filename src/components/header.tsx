import Link from "next/link";
import { signOut } from "@/app/actions";

export function Header({ sub, tabs, current, right }: {
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
        <form action={signOut}><button className="linkbtn" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
