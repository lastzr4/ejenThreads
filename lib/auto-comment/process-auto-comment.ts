import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { fetchProfilePosts } from "@/lib/threads/fetch-profile-posts";
import { publishReply } from "@/lib/threads/publish";
import { generateComment } from "@/lib/generation/generate-comment";
import { getValidThreadsAccessToken } from "@/lib/scheduler/get-threads-token";

// Auto-Comment's cron cycle: at most ONE new reply per user per call, so the
// natural ~60s tick cadence in server.js plus each user's own
// auto_comment_next_eligible_at (a random delay, re-rolled after every
// comment — see below) is what actually spaces replies out, rather than
// trying to burst through a whole day's quota in one run.
//
// Deliberately does NOT touch the user's personal home feed or any
// Playwright automation — targets are only posts from creators already
// tracked in this app (public data, GET /profile_posts), replied to via the
// official reply_to_id publish parameter. See README "Auto-Comment".

const FAILURE_BACKOFF_MS = 2 * 60 * 1000; // don't hot-loop every tick on a systemic error
const POSTS_PER_CREATOR = 10;

export interface AutoCommentResult {
  ok: boolean;
  posted: boolean;
  reason?: string; // why nothing was posted this cycle (not an error — e.g. "daily limit reached")
  error?: string;
}

interface AutoCommentSettings {
  auto_comment_enabled: boolean;
  auto_comment_daily_limit: number;
  auto_comment_delay_min_minutes: number;
  auto_comment_delay_max_minutes: number;
  auto_comment_next_eligible_at: string | null;
  auto_comment_count_today: number;
  auto_comment_count_reset_at: string | null;
}

function randomDelayMs(minMinutes: number, maxMinutes: number): number {
  const min = Math.max(1, minMinutes);
  const max = Math.max(min, maxMinutes);
  const minutes = min + Math.random() * (max - min);
  return Math.round(minutes * 60 * 1000);
}

export async function processAutoCommentForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string
): Promise<AutoCommentResult> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      `auto_comment_enabled, auto_comment_daily_limit, auto_comment_delay_min_minutes,
      auto_comment_delay_max_minutes, auto_comment_next_eligible_at, auto_comment_count_today,
      auto_comment_count_reset_at`
    )
    .eq("user_id", userId)
    .maybeSingle<AutoCommentSettings>();

  if (!settings || !settings.auto_comment_enabled) {
    return { ok: true, posted: false, reason: "disabled" };
  }

  const now = Date.now();

  if (settings.auto_comment_next_eligible_at && new Date(settings.auto_comment_next_eligible_at).getTime() > now) {
    return { ok: true, posted: false, reason: "waiting for delay" };
  }

  // Rolling 24h daily counter — resets the first time this runs after the
  // reset deadline passes, rather than a fixed calendar-day boundary.
  let countToday = settings.auto_comment_count_today;
  let resetAt = settings.auto_comment_count_reset_at ? new Date(settings.auto_comment_count_reset_at).getTime() : 0;
  if (!resetAt || resetAt <= now) {
    countToday = 0;
    resetAt = now + 24 * 60 * 60 * 1000;
    await supabase
      .from("user_settings")
      .update({ auto_comment_count_today: 0, auto_comment_count_reset_at: new Date(resetAt).toISOString() })
      .eq("user_id", userId);
  }

  if (countToday >= settings.auto_comment_daily_limit) {
    return { ok: true, posted: false, reason: "daily limit reached" };
  }

  let threadsUserId: string;
  let accessToken: string;
  try {
    ({ threadsUserId, accessToken } = await getValidThreadsAccessToken(supabase, userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Threads API not connected";
    await supabase
      .from("user_settings")
      .update({ auto_comment_next_eligible_at: new Date(now + FAILURE_BACKOFF_MS).toISOString() })
      .eq("user_id", userId);
    return { ok: false, posted: false, error: message };
  }

  const { data: creators } = await supabase
    .from("creators")
    .select("id, username")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!creators || creators.length === 0) {
    return { ok: true, posted: false, reason: "no tracked creators" };
  }

  // Shuffle so the same first creator/post doesn't always win when several
  // are eligible — spreads comments across the tracked list over time.
  const shuffled = [...creators].sort(() => Math.random() - 0.5);

  for (const creator of shuffled) {
    let posts;
    try {
      posts = await fetchProfilePosts(creator.username, accessToken, POSTS_PER_CREATOR);
    } catch {
      // One creator's lookup failing (private/renamed/rate-limited) — try
      // the next tracked creator instead of aborting the whole cycle.
      continue;
    }

    const candidates = posts.filter((p) => p.text && p.text.trim());
    if (candidates.length === 0) continue;

    const { data: alreadyCommented } = await supabase
      .from("commented_posts")
      .select("threads_post_id")
      .eq("user_id", userId)
      .in(
        "threads_post_id",
        candidates.map((p) => p.id)
      );
    const seen = new Set((alreadyCommented ?? []).map((r) => r.threads_post_id as string));
    const fresh = candidates.find((p) => !seen.has(p.id));
    if (!fresh) continue;

    // Found one eligible post — generate + publish, then stop (one comment
    // per cycle, regardless of how many other creators/posts were left).
    try {
      const commentText = await generateComment(fresh.text as string);
      const replyId = await publishReply(threadsUserId, accessToken, commentText, fresh.id);

      await supabase.from("commented_posts").insert({
        user_id: userId,
        creator_id: creator.id,
        threads_post_id: fresh.id,
        post_permalink: fresh.permalink,
        post_excerpt: (fresh.text as string).slice(0, 200),
        comment_text: commentText,
        threads_reply_id: replyId,
        status: "posted"
      });

      await supabase
        .from("user_settings")
        .update({
          auto_comment_count_today: countToday + 1,
          auto_comment_count_reset_at: new Date(resetAt).toISOString(),
          auto_comment_next_eligible_at: new Date(
            now + randomDelayMs(settings.auto_comment_delay_min_minutes, settings.auto_comment_delay_max_minutes)
          ).toISOString()
        })
        .eq("user_id", userId);

      return { ok: true, posted: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auto-comment failed";
      // Record the failed attempt (so it shows in history and — thanks to
      // the unique(user_id, threads_post_id) constraint — isn't retried
      // forever against a post that's genuinely broken, e.g. deleted or
      // reply_control set to disallow replies) and back off before the next
      // tick tries again.
      await supabase.from("commented_posts").insert({
        user_id: userId,
        creator_id: creator.id,
        threads_post_id: fresh.id,
        post_permalink: fresh.permalink,
        post_excerpt: (fresh.text as string).slice(0, 200),
        comment_text: "",
        status: "failed",
        error_message: message
      });
      await supabase
        .from("user_settings")
        .update({ auto_comment_next_eligible_at: new Date(now + FAILURE_BACKOFF_MS).toISOString() })
        .eq("user_id", userId);
      return { ok: false, posted: false, error: message };
    }
  }

  return { ok: true, posted: false, reason: "no new posts to comment on" };
}
