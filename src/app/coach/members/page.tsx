import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamColumn } from "@/components/team-column";
import { AutoSubmitSelect } from "@/components/client";
import { cancelInvite, inviteMember, removeMember, resendInvite, resetFreeCall, setTeam } from "@/app/actions";
import { BOOKING_ENABLED, isTeam, monthKey, TEAMS, type Booking, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
const MESSAGES: Record<string, [string, boolean]> = {
  sent: ["Invite sent.", true],
  moved: ["That person already had an account, so they've been moved onto the team.", true],
  invite: ["Check the email address and pick a team, then send again.", false],
  setup: ["Invites can't send yet: the app is missing SUPABASE_SERVICE_ROLE_KEY. Add it in Cloudflare under the Worker's Settings > Variables and Secrets (type Secret), then try again.", false],
  send: ["The invite was saved but the email didn't send. Try Resend below.", false],
};

function ago(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 14 ? `${days} days ago` : `${Math.floor(days / 7)} weeks ago`;
}

export default async function MembersPage({ searchParams: sp }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await sp;
  const { supabase, me } = await requireCoach();
  const month = monthKey(new Date(), TZ);
  const [{ data: profiles }, { data: contacts }, { data: invites }, { data: bookings }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "coach").order("name"),
    supabase.from("member_contacts").select("id, email"),
    supabase.from("invites").select("*").is("accepted_at", null).order("invited_at", { ascending: false }),
    supabase.from("bookings").select("*").eq("month", month),
  ]);
  const members = (profiles ?? []) as Profile[];
  const email = new Map((contacts ?? []).map((c) => [c.id as string, c.email as string]));
  const monthBookings = (bookings ?? []) as Booking[];
  const msg = Object.keys(MESSAGES).find((k) => searchParams[k] || searchParams.error === k);
  const defaultTeam = isTeam(searchParams.team) ? searchParams.team : "Monday";

  return (
    <>
      <Header sub="Coach view" tabs={[{ key: "team", label: "Back to teams", href: "/coach" }]} current="" right={<Link className="btn ghost small" href="/profile">My profile</Link>} />
      <div className="wrap layout coach">
        <TeamColumn members={members} current="members" />
        <main>
          <div className="intro"><div>
            <h1>Add and manage members</h1>
            <p>Invite people onto a team and move them between teams. A person&apos;s team decides what they can see.</p>
          </div></div>
          {msg && <div className={`notice${MESSAGES[msg][1] ? " good" : ""}`}>{MESSAGES[msg][0]}</div>}

          <form action={inviteMember} className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
            <div style={{ flex: "1 1 100%" }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Invite a member</h2>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.9rem" }}>They get an email with a sign-in link that puts them on the team you choose.</p>
            </div>
            <label style={{ flex: "2 1 260px", display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>Email
              <input className="input" type="email" name="email" required placeholder="name@example.com" />
            </label>
            <label style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>Team
              <select className="input" name="team" defaultValue={defaultTeam}>{TEAMS.map((t) => <option key={t} value={t}>{t} team</option>)}</select>
            </label>
            <button className="btn" type="submit" style={{ minHeight: 42 }}>Send invite</button>
          </form>

          <div className="tablebox">
            <table>
              <thead><tr><th>Member</th><th>Team</th><th>Weekly reminder</th>{BOOKING_ENABLED && <th>Calls this month</th>}<th>Last update</th><th /></tr></thead>
              <tbody>
                {members.length === 0 && <tr><td colSpan={BOOKING_ENABLED ? 6 : 5} className="muted">No members yet. Send your first invite above.</td></tr>}
                {members.map((m) => {
                  const b = monthBookings.filter((x) => x.member_id === m.id);
                  const free = b.some((x) => x.kind === "free"), paid = b.filter((x) => x.kind === "paid").length;
                  return (
                    <tr key={m.id}>
                      <td><b>{m.name}</b><div className="muted" style={{ fontSize: "0.82rem" }}>{email.get(m.id)}</div></td>
                      <td>
                        <AutoSubmitSelect label={`${m.name}'s team`} value={m.team ?? ""} action={setTeam.bind(null, m.id)}
                          options={[...TEAMS.map((t) => [t, t] as [string, string]), ["", "No team"]]} />
                      </td>
                      <td>{m.reminder_enabled ? `Email · ${m.reminder_day}` : <span className="muted">Off</span>}</td>
                      {BOOKING_ENABLED && <td>
                        {free ? "Free call used" : "1 free call left"}{paid ? ` + ${paid} paid` : ""}
                        {free && <form action={resetFreeCall.bind(null, m.id)} style={{ display: "inline" }}> <button className="linkbtn" type="submit" style={{ fontSize: "0.82rem" }}>Give back</button></form>}
                      </td>}
                      <td className="muted">{ago(m.updated_at)}</td>
                      <td>
                        <details>
                          <summary className="linkbtn" style={{ listStyle: "none" }}>Remove</summary>
                          <form action={removeMember.bind(null, m.id)} style={{ marginTop: 6 }}>
                            <button className="btn danger small" type="submit">Yes, remove {m.name.split(" ")[0]}</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(invites ?? []).length > 0 && (
            <section className="team-block">
              <h2>Waiting to accept</h2>
              {(invites ?? []).map((inv) => (
                <div key={inv.id} className="empty" style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", alignItems: "center" }}>
                  <b>{inv.email}</b><span className="muted">{inv.team} team · invited {ago(inv.invited_at).toLowerCase()}</span>
                  <span className="spacer" />
                  <form action={resendInvite.bind(null, inv.id)}><button className="btn ghost small" type="submit">Resend</button></form>
                  <form action={cancelInvite.bind(null, inv.id)}><button className="linkbtn" type="submit">Cancel invite</button></form>
                </div>
              ))}
            </section>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>Signed in as {me.name}, coach.</p>
        </main>
      </div>
    </>
  );
}
