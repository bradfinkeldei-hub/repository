// One-tap "I'm in" / "I'm out" links for the meeting check-in email. Each link
// carries a signature, so it works without signing in but only for that member
// and that meeting. The service role key, already a server secret, signs them.

async function sign(secret: string, memberId: string, meeting: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`rsvp:${memberId}:${meeting}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

export async function rsvpLink(site: string, secret: string, memberId: string, meeting: string, going: boolean) {
  const q = new URLSearchParams({ m: memberId, d: meeting, a: going ? "in" : "out", k: await sign(secret, memberId, meeting) });
  return `${site}/rsvp?${q}`;
}

export async function rsvpValid(secret: string, memberId: string, meeting: string, sig: string) {
  const want = await sign(secret, memberId, meeting);
  if (sig.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
