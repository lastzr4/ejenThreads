import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { refreshLongLivedToken } from "@/lib/threads/publish";

// Extracted out of process-schedule.ts so the same "get me a valid token,
// refreshing it if it's close to expiring" logic can be reused by the
// approve-and-publish action (app/dashboard/drafts/actions.ts) — that path
// didn't exist when this logic was first written inline, but now that
// publishing can happen either immediately (schedule with
// require_approval=false) or later at manual approval time, both need the
// exact same token-readiness check.

const REFRESH_MARGIN_MS = 5 * 24 * 60 * 60 * 1000; // refresh if <5 days from expiring

export interface ThreadsTokenResult {
  threadsUserId: string;
  accessToken: string;
}

/**
 * Throws a plain Error with a user-facing message if Threads API isn't
 * connected or the token has genuinely expired. Refreshing failing isn't
 * fatal on its own (proceeds with the current token) as long as it hasn't
 * actually expired yet.
 */
export async function getValidThreadsAccessToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string
): Promise<ThreadsTokenResult> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("threads_api_user_id, threads_api_access_token, threads_api_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.threads_api_user_id || !settings?.threads_api_access_token) {
    throw new Error("Threads API not connected — connect it in Settings");
  }

  let accessToken = settings.threads_api_access_token;
  const expiresAt = settings.threads_api_token_expires_at
    ? new Date(settings.threads_api_token_expires_at).getTime()
    : 0;

  if (expiresAt && expiresAt < Date.now()) {
    throw new Error("Threads API token has expired — reconnect it in Settings");
  }

  if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    try {
      const refreshed = await refreshLongLivedToken(accessToken);
      accessToken = refreshed.accessToken;
      await supabase
        .from("user_settings")
        .update({
          threads_api_access_token: refreshed.accessToken,
          threads_api_token_expires_at: refreshed.expiresAt
        })
        .eq("user_id", userId);
    } catch {
      // Not fatal — proceed with the current (still-valid) token and try
      // refreshing again next time.
    }
  }

  return { threadsUserId: settings.threads_api_user_id, accessToken };
}
