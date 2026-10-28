"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PROVIDERS: Record<string, string> = { google: "Google", azure: "Microsoft", apple: "Apple" };
const enabled = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google")
  .split(",").map((s) => s.trim()).filter((p) => p in PROVIDERS);

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one below.",
  profile: "We couldn't load your profile. Try signing in again.",
  google: "Google sign-in didn't work. Try again, or use your email and password.",
  invite: "That account hasn't been invited yet. Ask your coach for an invite, then sign in with the email it was sent to.",
};

type Mode = "password" | "link" | "forgot";
type State = "idle" | "busy" | "sent" | "error";

/** googleClientId switches Google to its own button, so Google's screen names this app instead of the Supabase address. */
export function LoginForm({ error, googleClientId }: { error?: string; googleClientId?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [googleError, setGoogleError] = useState<string>();
  const googleButton = useRef<HTMLDivElement>(null);
  const redirectTo = () => `${window.location.origin}/auth/callback`;
  const ownGoogleButton = !!googleClientId && enabled.includes("google");

  useEffect(() => {
    if (!ownGoogleButton || mode === "forgot") return;
    let cancelled = false;
    (async () => {
      // Google gets the hashed nonce, Supabase the raw one, so a token can't be replayed.
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
      const hashed = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      await loadGoogleScript();
      if (cancelled || !googleButton.current) return;
      const gsi = (window as unknown as { google: GoogleIdentity }).google.accounts.id;
      gsi.initialize({
        client_id: googleClientId!,
        nonce: hashed,
        use_fedcm_for_prompt: true,
        callback: async ({ credential }) => {
          setState("busy");
          const { error } = await createClient().auth.signInWithIdToken({ provider: "google", token: credential, nonce });
          if (error) {
            setState("idle");
            return setGoogleError(/database error/i.test(error.message) ? ERRORS.invite : ERRORS.google);
          }
          router.replace("/");
          router.refresh();
        },
      });
      gsi.renderButton(googleButton.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: googleButton.current.offsetWidth || 320 });
    })();
    return () => { cancelled = true; };
  }, [ownGoogleButton, mode, googleClientId, router]);

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
        <blockquote style={{ margin: 0, fontFamily: "var(--display)", fontStyle: "italic", fontSize: "1.25rem" }}>&ldquo;Life is a creation you get to make up!&rdquo;</blockquote>
      </div>
      <div className="panel">
        <form onSubmit={submit}>
          <h2 style={{ margin: "0 0 4px", fontFamily: "var(--display)", fontWeight: 600, letterSpacing: "-0.02em", fontSize: "1.9rem" }}>{title}</h2>
          <p className="muted" style={{ margin: "0 0 10px" }}>
            {mode === "forgot" ? "We'll email you a link to choose a new password." : "Use the email your coach invited."}
          </p>
          {error && state === "idle" && !googleError && <div className="notice">{ERRORS[error] ?? ERRORS.link}</div>}
          {googleError && <div className="notice">{googleError}</div>}
          {mode !== "forgot" && ownGoogleButton && <div ref={googleButton} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />}
          {mode !== "forgot" && enabled.filter((p) => !(ownGoogleButton && p === "google")).map((p) => (
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
          <a className="muted" href="/privacy" style={{ fontSize: "0.85rem" }}>Privacy policy and terms</a>
        </form>
      </div>
    </div>
  );
}

type GoogleIdentity = {
  accounts: {
    id: {
      initialize(options: { client_id: string; nonce: string; use_fedcm_for_prompt?: boolean; callback: (r: { credential: string }) => void }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
};

let googleScript: Promise<void> | undefined;
function loadGoogleScript() {
  googleScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { googleScript = undefined; reject(new Error("Couldn't load Google sign-in")); };
    document.head.appendChild(s);
  });
  return googleScript;
}
