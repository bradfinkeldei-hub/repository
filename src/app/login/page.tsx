"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const PROVIDERS: Record<string, string> = { google: "Google", azure: "Microsoft", apple: "Apple" };
const enabled = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google")
  .split(",").map((s) => s.trim()).filter((p) => p in PROVIDERS);

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one below.",
  profile: "We couldn't load your profile. Try signing in again.",
};

export default function Login({ searchParams: sp }: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = use(sp);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function oauth(provider: string) {
    await createClient().auth.signInWithOAuth({
      provider: provider as "google" | "azure" | "apple",
      options: { redirectTo: redirectTo(), scopes: provider === "azure" ? "email" : undefined },
    });
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setState("error");
    setState("sending");
    // shouldCreateUser: false keeps sign-in invite-only.
    const { error } = await createClient().auth.signInWithOtp({
      email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false },
    });
    setState(error ? "error" : "sent");
  }

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
        <form onSubmit={sendLink}>
          <h2 style={{ margin: "0 0 4px", fontFamily: "var(--display)", fontWeight: 400, fontSize: "1.9rem" }}>Sign in</h2>
          <p className="muted" style={{ margin: "0 0 10px" }}>Use the email your coach invited.</p>
          {searchParams.error && <div className="notice">{ERRORS[searchParams.error] ?? ERRORS.link}</div>}
          {enabled.map((p) => (
            <button key={p} type="button" className="sso" onClick={() => oauth(p)}>Continue with {PROVIDERS[p]}</button>
          ))}
          {enabled.length > 0 && <div className="or">or</div>}
          <label htmlFor="email" style={{ fontWeight: 600 }}>Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <button className="btn" type="submit" disabled={state === "sending"} style={{ minHeight: 48 }}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          {state === "sent" && <div className="notice good">Check your email for a sign-in link.</div>}
          {state === "error" && <div className="notice">We couldn&apos;t send a link to that address. Check it, or ask your coach for an invite.</div>}
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>
            New here? Joining starts with an invite from your coach. Your invite puts you on your team automatically.
          </p>
        </form>
      </div>
    </div>
  );
}
