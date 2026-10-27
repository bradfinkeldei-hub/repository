"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PROVIDERS: Record<string, string> = { google: "Google", azure: "Microsoft", apple: "Apple" };
const enabled = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google")
  .split(",").map((s) => s.trim()).filter((p) => p in PROVIDERS);

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one below.",
  profile: "We couldn't load your profile. Try signing in again.",
  invite: "That account hasn't been invited yet. Ask your coach for an invite, then sign in with the email it was sent to.",
};

type Mode = "password" | "link" | "forgot";
type State = "idle" | "busy" | "sent" | "error";

export default function Login({ searchParams: sp }: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = use(sp);
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const redirectTo = () => `${window.location.origin}/auth/callback`;

  function switchTo(m: Mode) {
    setMode(m);
    setState("idle");
  }

  async function oauth(provider: string) {
    await createClient().auth.signInWithOAuth({
      provider: provider as "google" | "azure" | "apple",
      options: { redirectTo: redirectTo(), scopes: provider === "azure" ? "email" : undefined },
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setState("error");
    setState("busy");
    const auth = createClient().auth;
    if (mode === "password") {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) return setState("error");
      router.replace("/");
      router.refresh();
      return;
    }
    // shouldCreateUser: false keeps sign-in invite-only. Reset emails link to
    // /auth/confirm (see the Reset password template in the README).
    const { error } = mode === "link"
      ? await auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false } })
      : await auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    setState(error ? "error" : "sent");
  }

  const title = mode === "forgot" ? "Reset your password" : "Sign in";
  const button = { password: "Sign in", link: "Email me a sign-in link", forgot: "Email me a reset link" }[mode];
  const sent = mode === "forgot" ? "If that email has an account, a reset link is on its way." : "Check your email for a sign-in link.";
  const failed = {
    password: "That email and password don't match. Try again, or use \"Forgot password?\".",
    link: "We couldn't send a link to that address. Check it, or ask your coach for an invite.",
    forgot: "We couldn't send a reset link. Check the address and try again.",
  }[mode];

  return (
    <div className="signin">
      <div className="hero">
        <div className="kicker">Sparkz of Courage</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <h1>The Coaching Circle</h1>
          <p>Your team&apos;s life wheels, what each of you is creating, and the commitments you&apos;re holding each other to.</p>
        </div>
        <p style={{ fontSize: "0.9rem" }}>Monday, Tuesday, Wednesday and Thursday teams</p>
      </div>
      <div className="panel">
        <form onSubmit={submit}>
          <h2 style={{ margin: "0 0 4px", fontFamily: "var(--display)", fontWeight: 400, fontSize: "1.9rem" }}>{title}</h2>
          <p className="muted" style={{ margin: "0 0 10px" }}>
            {mode === "forgot" ? "We'll email you a link to choose a new password." : "Use the email your coach invited."}
          </p>
          {searchParams.error && state === "idle" && <div className="notice">{ERRORS[searchParams.error] ?? ERRORS.link}</div>}
          {mode !== "forgot" && enabled.map((p) => (
            <button key={p} type="button" className="sso" onClick={() => oauth(p)}>Continue with {PROVIDERS[p]}</button>
          ))}
          {mode !== "forgot" && enabled.length > 0 && <div className="or">or</div>}
          <label htmlFor="email" style={{ fontWeight: 600 }}>Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          {mode === "password" && (
            <>
              <label htmlFor="password" style={{ fontWeight: 600 }}>Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          )}
          <button className="btn" type="submit" disabled={state === "busy"} style={{ minHeight: 48 }}>
            {state === "busy" ? (mode === "password" ? "Signing in…" : "Sending…") : button}
          </button>
          {state === "sent" && <div className="notice good">{sent}</div>}
          {state === "error" && <div className="notice">{failed}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            {mode === "password" ? (
              <>
                <button type="button" className="linkbtn" onClick={() => switchTo("forgot")}>Forgot password?</button>
                <button type="button" className="linkbtn" onClick={() => switchTo("link")}>Email me a link instead</button>
              </>
            ) : (
              <button type="button" className="linkbtn" onClick={() => switchTo("password")}>Sign in with a password</button>
            )}
          </div>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>
            New here? Joining starts with an invite from your coach. Your invite puts you on your team automatically.
          </p>
        </form>
      </div>
    </div>
  );
}
