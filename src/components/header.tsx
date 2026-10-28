import Link from "next/link";
import { signOut } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { Menu } from "@/components/client";
import { firstName, type Profile } from "@/lib/coaching";

/** The member's top tabs. Team, Accountability and Missions live on /team. */
export const MEMBER_TABS = [
  { key: "team", label: "Team", href: "/team?tab=team" },
  { key: "accountability", label: "Accountability", href: "/team?tab=accountability" },
  { key: "missions", label: "Missions", href: "/team?tab=missions" },
  { key: "progress", label: "My progress", href: "/progress" },
];

/** The coach's top tabs for the selected team. */
export function coachTabs(team: string, openCount?: number) {
  const href = (t: string) => `/coach?team=${team}&tab=${t}`;
  return [
    { key: "team", label: "Team", href: href("team") },
    { key: "accountability", label: "Accountability", href: href("accountability") },
    { key: "missions", label: "Missions", href: href("missions") },
    { key: "progress", label: "Progress", href: href("progress") },
    { key: "actions", label: "Coaches actions", href: href("actions"), count: openCount },
  ];
}

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
        <Link href="/" className="brand"><span className="mark" aria-hidden="true" />The Coaching Circle<small>{sub}</small></Link>
        {tabs.length > 0 && (
          <nav className="tabs" aria-label="Sections">
            {tabs.map((t) => (
              <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
                {t.label}{t.count ? <span className="count">{t.count}</span> : null}
              </Link>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {right}
        <Menu label={<><Avatar name={me.name} url={me.avatar_url} size={32} /><span className="menu-name">{firstName(me.name)}</span></>}>
          <Link href="/profile">My profile</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/welcome">How it works</Link>
          <form action={signOut}><button type="submit">Sign out</button></form>
        </Menu>
      </div>
    </header>
  );
}
