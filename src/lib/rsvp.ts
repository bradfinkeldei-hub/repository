// One-tap "I'm in" / "I'm out" links for the meeting check-in email. Each link
// carries a signature, so it works without signing in but only for that member
// and that meeting. The service role key, already a server secret, signs them.
//
// Links are path-only and lowercase (/rsvp/in/<member>/<date>/<sig>), because
// email security filters that rewrite links can drop query strings or change case.

async function mac(secret: string, memberId: string, meeting: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`rsvp:${memberId}:${meeting}`)));
}

async function sign(secret: string, memberId: string, meeting: string) {
  return [...(await mac(secret, memberId, meeting)).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The first emails used a base64 signature in the query string. Still accepted. */
async function signV1(secret: string, memberId: string, meeting: string) {
  const m = await mac(secret, memberId, meeting);
  return btoa(String.fromCharCode(...m)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

export async function rsvpLink(site: string, secret: string, memberId: string, meeting: string, going: boolean) {
  return `${site}/rsvp/${going ? "in" : "out"}/${memberId}/${meeting}/${await sign(secret, memberId, meeting)}`;
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function rsvpValid(secret: string, memberId: string, meeting: string, sig: string) {
  memberId = memberId.toLowerCase();
  return same(sig.toLowerCase(), await sign(secret, memberId, meeting)) || same(sig, await signV1(secret, memberId, meeting));
}
