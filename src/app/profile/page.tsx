import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { removeAvatar, saveProfile, setAvatar } from "@/app/actions";
import { PhotoPicker, RangeField, ReminderFields } from "@/components/client";
import { Avatar } from "@/components/avatar";
import { AccountTabs } from "@/components/account-tabs";
import { AREAS, teamOptions, type Profile } from "@/lib/coaching";

export default async function ProfilePage({ searchParams: sp }: { searchParams: Promise<{ id?: string; error?: string }> }) {
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

  return (
    <div className="wrap" style={{ paddingBlock: "32px 64px" }}>
      {own ? <AccountTabs current="profile" back={back} /> : <Link href={back} className="linkbtn">← Back</Link>}
      <h1 style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: "2rem", margin: own ? "0 0 4px" : "12px 0 4px" }}>{own ? "Your profile" : `Edit ${m.name}`}</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>{own && !isCoach ? "Your team sees what you share here." : "Changes show up for the member's team right away."}</p>
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <Avatar name={m.name} url={m.avatar_url} size={88} />
        {own && !viewing
          ? <PhotoPicker userId={me.id} hasPhoto={!!m.avatar_url} save={setAvatar} remove={removeAvatar} />
          : <span className="hint">Only {m.name || "they"} can change their photo.</span>}
      </div>
      {searchParams.error && <div className="notice" style={{ marginBottom: 16 }}>That didn&apos;t save. Check your connection and try again.</div>}
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
          <span className="hint">Rate how satisfied you are in each area today, from 1 to 10.</span>
          {AREAS.map(([k, label]) => <RangeField key={k} name={`wheel_${k}`} label={label} initial={Number(m.wheel?.[k]) || 5} />)}
        </fieldset>
        <label>What I&apos;m actively creating
          <span className="hint">The one thing in your life you&apos;re bringing into being right now.</span>
          <textarea name="creating" defaultValue={m.creating} maxLength={400} />
        </label>
        <label>What I&apos;m being held accountable to
          <span className="hint">A concrete commitment your team can check in on each week.</span>
          <textarea name="accountability" defaultValue={m.accountability} maxLength={400} />
        </label>
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
    </div>
  );
}
