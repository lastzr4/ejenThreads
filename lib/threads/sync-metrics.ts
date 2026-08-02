import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { fetchPostInsights } from "@/lib/threads/insights";
import { getValidThreadsAccessToken } from "@/lib/scheduler/get-threads-token";

// Keeps scheduled_posts.metric_* reasonably fresh for posts this app
// published, without hammering the Insights API. Two bounds keep each call
// cheap: only posts from the last STALE_WINDOW_DAYS (engagement mostly
// settles by then — no point polling a 3-month-old post forever), and only
// ones not already synced within REFRESH_MARGIN_MS (so re-running the tick
// every minute — see server.js — is still a fast no-op most of the time,
// same "check often, act rarely" shape as the schedules/auto-comment ticks).
const STALE_WINDOW_DAYS = 14;
const REFRESH_MARGIN_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_POSTS_PER_RUN = 20;

export interface SyncMetricsResult {
  checked: number;
  updated: number;
  skipped: number;
}

/**
 * Refreshes engagement metrics for this user's recently-published posts
 * that are due for a refresh. Never throws — if the user isn't connected to
 * the Threads API (or the token has expired), returns a zeroed result
 * rather than failing the caller's loop over every user.
 */
export async function syncPostMetricsForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string
): Promise<SyncMetricsResult> {
  let accessToken: string;
  try {
    ({ accessToken } = await getValidThreadsAccessToken(supabase, userId));
  } catch {
    return { checked: 0, updated: 0, skipped: 0 };
  }

  const staleWindowStart = new Date(Date.now() - STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const refreshCutoff = new Date(Date.now() - REFRESH_MARGIN_MS).toISOString();

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("id, threads_post_id")
    .eq("user_id", userId)
    .eq("status", "posted")
    .not("threads_post_id", "is", null)
    .gte("posted_at", staleWindowStart)
    .or(`metrics_updated_at.is.null,metrics_updated_at.lt.${refreshCutoff}`)
    .order("posted_at", { ascending: false })
    .limit(MAX_POSTS_PER_RUN);

  const rows = posts ?? [];
  let updated = 0;

  for (const row of rows) {
    const threadsPostId = row.threads_post_id as string;
    const insights = await fetchPostInsights(threadsPostId, accessToken);
    if (!insights) continue;

    const { error } = await supabase
      .from("scheduled_posts")
      .update({
        metric_views: insights.views,
        metric_likes: insights.likes,
        metric_replies: insights.replies,
        metric_reposts: insights.reposts,
        metric_quotes: insights.quotes,
        metric_shares: insights.shares,
        metrics_updated_at: new Date().toISOString()
      })
      .eq("id", row.id as string);

    if (!error) updated++;
  }

  return { checked: rows.length, updated, skipped: rows.length - updated };
}
