import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";

export default async function Home() {
  const { me } = await requireProfile();
  if (me.role === "coach") redirect("/coach");
  // New members start on the welcome guide until they've filled in their wheel.
  redirect(Object.keys(me.wheel ?? {}).length === 0 ? "/welcome" : "/team");
}
