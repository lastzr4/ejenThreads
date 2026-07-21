import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * ONLY use this in trusted server-only code that has no per-request user
 * session to scope queries to (the cron scheduler in
 * app/api/cron/run-schedules, which must read/write every user's
 * posting_schedules, not just one). Never import this into a Server
 * Component, Server Action, or anything reachable with a user's own
 * request — use lib/supabase/server.ts (the cookie-scoped client, which
 * RLS protects) for all normal per-user data access.
 */
let adminClient: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createAdminClient() {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to use the admin client (needed for the Module 4 cron scheduler)."
      );
    }
    adminClient = createSupabaseClient<Database>(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}
