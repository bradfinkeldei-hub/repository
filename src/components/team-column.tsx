import Link from "next/link";
import { TEAMS, type Profile, type Suggestion } from "@/lib/coaching";

/** The coach's team list. Members never see this. */
export function TeamColumn({ members, selected, tab, actions, current }: {
  members: Profile[];
  selected?: string;
  tab?: string;
  actions?: Suggestion[];
  current?: "members";
}) {
  const t = tab ?? "team";
  const count = (team: string) => {
    if (actions) {
      const open = actions.filter((a) => !a.done && (team === "all" || (a.team ?? "none") === team)).length;
      return `${open} open`;
    }
    return String(team === "all" ? members.length : members.filter((m) => (m.team ?? "none") === team).length);
  };
  const items: [string, string][] = [["all", "All teams"], ...TEAMS.map((x) => [x, x] as [string, string])];
  if (members.some((m) => !m.team)) items.push(["none", "Not on a team"]);
  return (
    <nav className="teams" aria-label="Teams">
      <div className="label">Teams</div>
      {items.map(([key, label]) => (
        <Link key={key} href={`/coach?team=${key}&tab=${t}`} aria-current={!current && selected === key ? "page" : undefined}>
          {label}<span>{count(key)}</span>
        </Link>
      ))}
      <hr />
      <Link href="/coach/members" aria-current={current === "members" ? "page" : undefined}>Add or manage members<span>›</span></Link>
      <p className="note">Only you see this column. Members see just their own team.</p>
    </nav>
  );
}
