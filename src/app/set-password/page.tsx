import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { setPassword } from "@/app/actions";

const ERRORS: Record<string, string> = {
  short: "Use at least 8 characters.",
  match: "The two passwords don't match.",
  save: "That password didn't save. Try a different one.",
};

/** Where invites and password resets land, and "change password" from the profile. */
export default async function SetPasswordPage({ searchParams: sp }: { searchParams: Promise<{ welcome?: string; error?: string }> }) {
  const searchParams = await sp;
  const { me } = await requireProfile();
  const welcome = searchParams.welcome === "1";
  return (
    <div className="wrap" style={{ paddingBlock: "32px 64px", maxWidth: 520 }}>
      {!welcome && <Link href="/profile" className="linkbtn">← Back</Link>}
      <h1 style={{ fontFamily: "var(--display)", fontWeight: 400, fontSize: "2rem", margin: "12px 0 4px" }}>
        {welcome ? `Welcome${me.name ? `, ${me.name.split(" ")[0]}` : ""}! Choose a password` : "Set your password"}
      </h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>Next time, sign in with your email and this password.</p>
      {searchParams.error && <div className="notice" style={{ marginBottom: 16 }}>{ERRORS[searchParams.error] ?? ERRORS.save}</div>}
      <form action={setPassword} className="form">
        {welcome && <input type="hidden" name="welcome" value="1" />}
        <label>New password<input type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
        <label>Type it again<input type="password" name="confirm" autoComplete="new-password" minLength={8} required /></label>
        <div className="row">
          <button className="btn" type="submit">Save password</button>
          <Link className="linkbtn" href="/">{welcome ? "Skip for now" : "Cancel"}</Link>
        </div>
      </form>
    </div>
  );
}
