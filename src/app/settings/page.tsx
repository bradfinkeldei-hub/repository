import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { changeEmail, saveSettings, signOut } from "@/app/actions";
import { ReminderFields } from "@/components/client";
import { AccountTabs } from "@/components/account-tabs";
import { teamLabel } from "@/lib/coaching";
import { createAdminClient } from "@/lib/supabase/admin";

const MESSAGES: Record<string, [string, boolean]> = {
  saved: ["Settings saved.", true],
  password: ["Password changed.", true],
  sent: ["Check your inbox. We sent a link to confirm your new email (and, if asked, one to your current email too). Your email changes once you click it.", true],
  half: ["Thanks, that's one confirmed. Now click the link we sent to your other email address to finish.", true],
  done: ["Your email address is updated. Use it next time you sign in.", true],
  save: ["That didn't save. Check your connection and try again.", false],
  email: ["That email address didn't work. Check it and try again.", false],
  taken: ["Someone already uses that email address here.", false],
};

/** The signed-in person's own account: name, sign-in email, password, reminders, sign out. */
export default async function SettingsPage({ searchParams: sp }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await sp;
  const { supabase, me, user, names, viewing } = await requireProfile();
  // Confirmed email changes land here; point reminders at the new address.
  const { data: contact } = await supabase.from("member_contacts").select("email").eq("id", me.id).maybeSingle();
  if (!viewing && user.email && contact && contact.email !== user.email && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await createAdminClient().from("member_contacts").update({ email: user.email }).eq("id", me.id);
  }
  const isCoach = me.role === "coach";
  const back = isCoach ? "/coach" : "/team";
  const key = searchParams.error ?? searchParams.email ?? (searchParams.saved ? "saved" : searchParams.password ? "password" : undefined);
  const msg = key ? MESSAGES[key] : undefined;
  // While the coach views as a member, show the member's address, not the coach's.
  const email = viewing ? contact?.email ?? "" : user.email ?? "";
  const providers = viewing ? [] : (user.app_metadata?.providers as string[] | undefined) ?? [];
  const pending = viewing ? undefined : user.new_email;

  return (
    <div className="wrap" style={{ paddingBlock: "32px 64px", maxWidth: 720 }}>
      <AccountTabs current="settings" back={back} />
      <h1 style={{ fontFamily: "var(--display)", fontWeight: 600, letterSpacing: "-0.02em", fontSize: "2rem", margin: "0 0 4px" }}>Settings</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>Only you{isCoach ? "" : " and your coach"} can see these.</p>
      {msg && <div className={`notice${msg[1] ? " good" : ""}`} style={{ marginBottom: 16 }}>{msg[0]}</div>}

      <form action={saveSettings} className="form">
        <fieldset>
          <legend>About you</legend>
          <label>Name<input type="text" name="name" defaultValue={me.name} maxLength={60} required />
            <span className="hint">How you appear to your team.</span>
          </label>
          <p className="hint" style={{ margin: 0 }}>{isCoach ? "You're the coach, so you can see every team." : `You're on the ${teamLabel(me.team, names)}. ${me.team ? "Your coach can move you to another team." : "Your coach will add you to a team."}`}</p>
        </fieldset>
        <fieldset>
          <legend>Weekly reminder</legend>
          <ReminderFields enabled={me.reminder_enabled} day={me.reminder_day} />
        </fieldset>
        <div className="row"><button className="btn" type="submit">Save settings</button></div>
      </form>

      <div className="form" style={{ marginTop: 28 }}>
        <fieldset>
          <legend>Signing in</legend>
          <form action={changeEmail} className="form" style={{ gap: 10 }}>
            <label>Email address
              <input type="email" name="email" defaultValue={email} maxLength={200} required autoComplete="email" />
              <span className="hint">
                {pending ? `Waiting for you to confirm ${pending}. ` : ""}
                You sign in and get reminders with this address. To change it, type the new one and we&apos;ll email you a link to confirm.
              </span>
            </label>
            <div className="row"><button className="btn ghost small" type="submit">Change email</button></div>
          </form>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Password</span>
            <Link className="btn ghost small" href="/set-password">Set or change password</Link>
          </div>
          {providers.includes("google") && <span className="hint">You can also sign in with Google.</span>}
        </fieldset>
        <fieldset>
          <legend>Sign out</legend>
          <span className="hint">Sign out of The Coaching Circle on this device.</span>
          <form action={signOut}><button className="btn danger small" type="submit">Sign out</button></form>
        </fieldset>
      </div>
    </div>
  );
}
