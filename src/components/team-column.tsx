import Link from "next/link";
import { startViewAs } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/client";
import { teamLabel, teamOptions, type Profile, type Suggestion, type TeamNames } from "@/lib/coaching";

/** The coach's team list. Members never see this. */
export function TeamColumn({ members, names, selected, tab, actions, current }: {
  members: Profile[];
  names: TeamNames;
  selected?: string;
  tab?: string;
  actions?: Suggestion[];
  current?: "members" | "teams";
}) {
  const t = tab ?? "team";
  const count = (team: string) => {
    if (actions) {
      const open = actions.filter((a) => !a.done && (team === "all" || (a.team ?? "none") === team)).length;
      return `${open} open`;
    }
    return String(team === "all" ? members.length : members.filter((m) => (m.team ?? "none") === team).length);
  };
  const items: [string, string][] = [["all", "All teams"], ...teamOptions(names)];
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
      <Link href="/coach/teams" aria-current={current === "teams" ? "page" : undefined}>Rename teams<span>›</span></Link>
      {members.length > 0 && (
        <label className="viewas-pick">
          <span className="label">See the app as a member</span>
          <AutoSubmitSelect
            label="View the app as a member"
            value=""
            action={startViewAs}
            options={[["", "Pick a member…"], ...members.map((m) => [m.id, `${m.name || "No name"}${m.team ? ` (${teamLabel(m.team, names)})` : ""}`] as [string, string])]}
          />
        </label>
      )}
      <p className="note">Only you see this column. Members see just their own team.</p>
    </nav>
  );
}
