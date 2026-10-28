"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkProblem } from "./check";

/** The confirm button on the page the email's In and Out links open. */
export async function answerFromEmail(formData: FormData) {
  const member = String(formData.get("m") ?? "").toLowerCase();
  const meeting = String(formData.get("d") ?? "");
  const going = formData.get("a") === "in";
  const problem = await linkProblem(member, meeting, String(formData.get("k") ?? ""));
  if (problem) redirect(`/rsvp/thanks?error=${problem}`);
  const { error } = await createAdminClient().from("attendance")
    .upsert({ member_id: member, meeting, going, updated_at: new Date().toISOString() });
  redirect(`/rsvp/thanks?${error ? "error=save" : `a=${going ? "in" : "out"}&d=${meeting}`}`);
}
