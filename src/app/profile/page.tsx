import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { changeMemberEmail, removeAvatar, removeMemberAvatar, saveProfile, sendMemberPasswordReset, setAvatar, setMemberAvatar } from "@/app/actions";
import { CommitmentFields, PhotoPicker, RangeField, ReminderFields } from "@/components/client";
import { Avatar } from "@/components/avatar";
import { AccountTabs } from "@/components/account-tabs";
import { AREAS, commitmentList, MAX_COMMITMENTS, teamOptions, type Profile } from "@/lib/coaching";

const NOTICES: Record<string, [string, boolean]> = {
  newemail: ["Their sign-in email is changed. They use the new address from now on, and reminders go there.", true],
  resetsent: ["Sent. They'll get an email with a link to set a new password.", true],
  save: ["That didn't save. Check your connection and try again.", false],
  email: ["That email address didn't work. Check it and try again.", false],
  taken: ["Someone already uses that email address here.", false],
  noemail: ["There's no email address on file for them.", false],
  setup: ["This needs the SUPABASE_SERVICE_ROLE_KEY variable in Cloudflare.", false],
  reset: ["That reset email didn't send. Try again in a minute.", false],
};

export default async function ProfilePage({ searchParams: sp }: { searchParams: Promise<{ id?: string; error?: string; saved?: string }> }) {
  const searchParams = await sp;
  const { viewing, supabase, me, names } = await requireProfile();
  const isCoach = me.role === "coach";
  let m: Profile = me;
  if (searchParams.id && searchParams.id !== me.id) {
    if (!isCoach) redirect("/profile");
    const { data } = await supabase.from("profiles").select("*").eq("id", searchParams.id).single();
    if (!data) redirect("/coach");
    m = data as Profile;
  }
  const own = m.id === me.id;
  const back = isCoach ? "/coach" : "/team";
  const notice = NOTICES[searchParams.saved ?? searchParams.error ?? ""];
  const { data: contact } = !own && isCoach ? await supabase.from("member_contacts").select("email").eq("id", m.id).maybeSingle() : { data: null };

  return (
    <div className="wrap" style={{ paddingBlock: "32px 64px" }}>
      {own ? <AccountTabs current="profile" back={back} /> : <Link href={back} className="linkbtn">← Back</Link>}
      <h1 style={{ fontFamily: "var(--display)", fontWeight: 600, letterSpacing: "-0.02em", fontSize: "2rem", margin: own ? "0 0 4px" : "12px 0 4px" }}>{own ? "Your profile" : `Edit ${m.name}`}</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>{own && !isCoach ? "Your team sees what you share here." : own ? "Changes show up for the member's team right away." : `You can change anything here for ${m.name || "them"}. It shows up for their team right away.`}</p>
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <Avatar name={m.name} url={m.avatar_url} size={88} />
        {own && !viewing
          ? <PhotoPicker userId={me.id} hasPhoto={!!m.avatar_url} save={setAvatar} remove={removeAvatar} />
          : isCoach && !viewing
            ? <PhotoPicker userId={m.id} hasPhoto={!!m.avatar_url} upload={setMemberAvatar.bind(null, m.id)} remove={removeMemberAvatar.bind(null, m.id)} />
            : <span className="hint">Only {m.name || "they"} can change their photo.</span>}
      </div>
      {notice && <div className={`notice${notice[1] ? " good" : ""}`} style={{ marginBottom: 16 }}>{notice[0]}</div>}
      <form action={saveProfile} className="form">
        <fieldset disabled={viewing} className="bare">
        {!own && <input type="hidden" name="id" value={m.id} />}
        <label>Name<input type="text" name="name" defaultValue={m.name} maxLength={60} required /></label>
        {isCoach && !own && (
          <label>Team
            <select name="team" defaultValue={m.team ?? ""}>
              {teamOptions(names).map(([t, label]) => <option key={t} value={t}>{label}</option>)}
              <option value="">Not on a team</option>
            </select>
            <span className="hint">Moving someone changes which team they can see.</span>
          </label>
        )}
        <fieldset>
          <legend>Life wheel</legend>
          <span className="hint">{own ? "Rate how satisfied you are in each area today, from 1 to 10." : "Their own ratings, from 1 to 10. Areas showing – aren't rated yet and stay that way unless you move the slider."}</span>
          {/* The coach editing someone's name or team shouldn't fill in scores they never gave. */}
          {AREAS.map(([k, label]) => <RangeField key={k} name={`wheel_${k}`} label={label} initial={Number(m.wheel?.[k]) || 5} unrated={!own && !m.wheel?.[k]} />)}
        </fieldset>
        <label>Who am I going to be?
          <span className="hint">This is a state of being, not a goal or a to-do. It&apos;s who you choose to be as you walk into your week, whatever happens. Finish the sentence <b>&ldquo;I am going to be&hellip;&rdquo;</b> with one to three words that describe how you&apos;ll show up.</span>
          <textarea name="becoming" defaultValue={m.becoming ?? ""} maxLength={400} placeholder="I am going to be proactive, a leader, and happy." />
          <span className="hint">Ideas: proactive · a leader · happy · productive · patient · courageous · present · generous · calm · playful</span>
          <span className="hint"><b>Why it comes first:</b> what you do flows from who you&apos;re being. Decide who you&apos;re going to be, and what you create and the commitments you keep become the natural next steps.</span>
        </label>
        <label>What I&apos;m actively creating
          <span className="hint">The one thing in your life you&apos;re bringing into being right now.</span>
          <textarea name="creating" defaultValue={m.creating} maxLength={400} />
        </label>
        <div className="form-group">
          <span className="form-label">What I&apos;m being held accountable to</span>
          <span className="hint">One specific thing you&apos;ll do before the next meeting, so your team can ask &ldquo;did you do it?&rdquo; For example: &ldquo;Work out 4 mornings&rdquo; or &ldquo;Make 3 calls for the new project.&rdquo; You can add up to {MAX_COMMITMENTS}.</span>
          <CommitmentFields initial={commitmentList(m.accountability)} max={MAX_COMMITMENTS} />
        </div>
        <label>My mission
          <span className="hint">The mission you&apos;re living into.</span>
          <textarea name="mission" defaultValue={m.mission} maxLength={600} />
        </label>
        {own ? (
          <p className="hint" style={{ margin: 0 }}>Your weekly reminder, email and password are in <Link href="/settings">Settings</Link>.</p>
        ) : (
          <fieldset>
            <legend>Weekly reminder</legend>
            <ReminderFields enabled={m.reminder_enabled} day={m.reminder_day} />
          </fieldset>
        )}
        <div className="row">
          <button className="btn" type="submit">Save</button>
          <Link className="btn ghost" href={back}>Cancel</Link>
        </div>
        </fieldset>
      </form>
      {!own && isCoach && (
        <div className="form" id="signin" style={{ marginTop: 28 }}>
          <fieldset>
            <legend>More for {m.name || "this member"}</legend>
            <span className="hint">Their weekly check-offs, past weeks, milestones and comments are on their card: tap the circles to tick commitments, and open Milestones to add a win. Their meeting answer is on the team&apos;s check-in card.</span>
            <div className="row">
              <Link className="btn ghost small" href={`/progress?id=${m.id}`}>Past weeks</Link>
              <Link className="btn ghost small" href={`/coach?team=${m.team ?? "none"}#member-${m.id}`}>Their card</Link>
            </div>
          </fieldset>
          <fieldset>
            <legend>Signing in</legend>
            <form action={changeMemberEmail.bind(null, m.id)} className="form" style={{ gap: 10 }}>
              <label>Email address
                <input type="email" name="email" defaultValue={contact?.email ?? ""} maxLength={200} required autoComplete="off" />
                <span className="hint">They sign in and get reminders with this address. Changing it here takes effect right away, with no confirming email, so double-check it.</span>
              </label>
              <div className="row"><button className="btn ghost small" type="submit">Change email</button></div>
            </form>
            <form action={sendMemberPasswordReset.bind(null, m.id)} className="row" style={{ justifyContent: "space-between" }}>
              <span>Password</span>
              <button className="btn ghost small" type="submit">Email them a reset link</button>
            </form>
            <span className="hint">You can&apos;t see or set their password. The link lets them choose a new one.</span>
          </fieldset>
        </div>
      )}
    </div>
  );
}
