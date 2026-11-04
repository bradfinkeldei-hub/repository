import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { isPilot } from "@/lib/coaching";

export default async function Home() {
  const { me } = await requireProfile();
  if (me.role === "coach") redirect("/coach");
  // The Pilot group starts with the Focus questions, which /team sends them to.
  if (isPilot(me.team)) redirect("/team");
  // New members start on the welcome guide until they've filled in their wheel.
  redirect(Object.keys(me.wheel ?? {}).length === 0 ? "/welcome" : "/team");
}
