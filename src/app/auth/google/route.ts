import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Google's sign-in button posts here (redirect mode) with an ID token for Supabase. */
export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const back = (error?: string) => NextResponse.redirect(`${origin}${error ? `/login?error=${error}` : "/"}`, 303);
  const form = await request.formData();
  const credential = form.get("credential");
  // Google sets the same random value as a cookie and a form field. Some
  // browsers hold the cookie back on this cross-site post, so only a mismatch fails.
  const csrf = request.cookies.get("g_csrf_token")?.value;
  if (typeof credential !== "string" || (csrf && csrf !== form.get("g_csrf_token"))) return back("google");
  const { error } = await (await createClient()).auth.signInWithIdToken({ provider: "google", token: credential });
  // A new Google account that wasn't invited is turned away by the database; an archived member's account is blocked.
  if (error) return back(/database error/i.test(error.message) ? "invite" : /banned/i.test(error.message) ? "archived" : "google");
  return back();
}
