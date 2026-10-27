import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Invite, sign-in and password reset emails link here (see the email templates in the README). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type) {
    const { error } = await (await createClient()).auth.verifyOtp({ type, token_hash });
    // New members and password resets go straight to choosing a password.
    if (!error && type === "invite") return NextResponse.redirect(`${origin}/set-password?welcome=1`);
    if (!error && type === "recovery") return NextResponse.redirect(`${origin}/set-password`);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
