import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Google, Microsoft, Apple and emailed sign-in links land here with a code. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "";
  const dest = /^\/[a-z-]*$/.test(next) ? next : "/";
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${dest === "/settings" ? "/settings?email=done" : dest}`);
  }
  // An email change confirmed from one address still needs the link sent to the other.
  if (dest === "/settings" && searchParams.get("message")) return NextResponse.redirect(`${origin}/settings?email=half`);
  // A new Google account that wasn't invited is turned away by the database.
  const why = searchParams.get("error_description") ?? "";
  return NextResponse.redirect(`${origin}/login?error=${/database error/i.test(why) ? "invite" : "link"}`);
}
