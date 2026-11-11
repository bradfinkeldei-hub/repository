/**
 * Weaves a member's three mission answers into one smooth example sentence that
 * starts with "My mission is". Their own words are kept exactly; only the joining
 * words are added. Parts marked own: true are what they wrote (shown underlined).
 */
export type MissionPart = { text: string; own?: boolean };

export function composeMission(matters: string, difference: string, best: string): MissionPart[] {
  const a = soften(clean(matters)), b = soften(clean(difference)), c = soften(clean(best));
  if (!a && !b && !c) return [];
  let who = b, how = "";
  const cut = b.search(/,\s*|\s+by\s+/);
  if (cut > 0) { who = b.slice(0, cut); how = b.slice(cut).replace(/^,\s*/, "").trim(); }
  const parts: MissionPart[] = [{ text: "My mission is to " }];
  if (who) {
    parts.push({ text: "make a difference for " }, { text: who, own: true });
    if (how) parts.push({ text: " " }, { text: how, own: true });
  } else {
    parts.push({ text: "live by what matters most" });
  }
  if (a) parts.push({ text: who ? ", guided by " : ": " }, { text: list(a), own: true });
  if (c) parts.push({ text: ", and to be at my best " }, ...(/^\w+ing\b/.test(c) ? [{ text: "when I am " }, { text: c, own: true }] : [{ text: c, own: true }]));
  parts.push({ text: "." });
  return parts;
}

export function missionText(parts: MissionPart[]) {
  return parts.map((p) => p.text).join("");
}

function clean(t: string) {
  return String(t || "").trim().replace(/[.!\s]+$/, "");
}
/** "My kids" reads as "my kids" mid-sentence. Names and "I" keep their capitals. */
function soften(t: string) {
  return /^(My|Our|Being|The|A|An|Helping|Making|Outside|With|When|Family|Freedom|People|Others)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}
function list(t: string) {
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  return parts.length > 2 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts.join(" and ");
}
