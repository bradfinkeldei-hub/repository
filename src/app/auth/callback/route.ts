import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Google, Microsoft, Apple and emailed sign-in links land here with a code. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  // A new Google account that wasn't invited is turned away by the database.
  const why = searchParams.get("error_description") ?? "";
  return NextResponse.redirect(`${origin}/login?error=${/database error/i.test(why) ? "invite" : "link"}`);
}
