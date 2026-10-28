import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamColumn } from "@/components/team-column";
import { renameTeams } from "@/app/actions";
import { teamLabel, TEAMS, type Profile } from "@/lib/coaching";

/** Where the coach renames teams. The day each team meets doesn't change. */
export default async function TeamsPage({ searchParams: sp }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names } = await requireCoach();
  const { data } = await supabase.from("profiles").select("*").neq("role", "coach").is("archived_at", null).order("name");
  const members = (data ?? []) as Profile[];

  return (
    <>
      <Header me={me} sub="Coach view" tabs={[{ key: "team", label: "Back to teams", href: "/coach" }]} current="" />
      <div className="wrap layout coach">
        <TeamColumn members={members} names={names} current="teams" />
        <main>
          <div className="intro"><div>
            <h1>Rename teams</h1>
            <p>Type a new name in any box and tap Save. Members see the new name right away; nobody changes team and meeting days stay the same. Empty a box to go back to the day name.</p>
          </div></div>
          {searchParams.saved && <div className="notice good">Team names saved. <Link href="/coach">Back to teams</Link></div>}
          {searchParams.error && <div className="notice">The team names didn&apos;t save. Try again.</div>}
          <form action={renameTeams} className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
            {TEAMS.map((t) => (
              <label key={t} style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>{t === "Example" ? "Example (demo) team" : `Team that meets ${t}`}
                <input className="input" type="text" name={`name_${t}`} maxLength={40} defaultValue={teamLabel(t, names)} placeholder={`${t} team`} />
              </label>
            ))}
            <button className="btn" type="submit" style={{ minHeight: 42 }}>Save team names</button>
          </form>
        </main>
      </div>
    </>
  );
}
