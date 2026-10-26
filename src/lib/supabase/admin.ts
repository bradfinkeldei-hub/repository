import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses access rules: only for invites and the reminder job. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
