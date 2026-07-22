import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { publishThreadPosts, refreshLongLivedToken } from "@/lib/threads/publish";

// Shared by both the cron tick (app/api/cron/run-schedules, iterates every
// due schedule across every user with the admin client) and the manual
// "Run now" button on the Schedules page (a single schedule, the owning
// user's own session-scoped client) — same generate-then-publish logic
// either way, just reused from two different callers/clients so it only
// lives in one place.

const REFRESH_MARGIN_MS = 5 * 24 * 60 * 60 * 1000; // refresh if <5 days from expiring

export interface ScheduleRow {
  id: string;
  user_id: string;
  creator_id: string;
  interval_hours: number;
  post_type: string;
  topic: string | null;
  niche?: string | null;
  role_prompt?: string | null;
  generate_image?: boolean | null;
}

export interface ProcessScheduleResult {
  ok: boolean;
  error?: string;
}

/**
 * Generates a new styled post and publishes it via the Threads API for one
 * schedule, then records the result and reschedules next_run_at — success
 * or failure either way (never throws; check the return value).
 */
export async function processSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  schedule: ScheduleRow
): Promise<ProcessScheduleResult> {
  const nextRunAt = new Date(Date.now() + schedule.interval_hours * 60 * 60 * 1000).toISOString();

  try {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("threads_api_user_id, threads_api_access_token, threads_api_token_expires_at")
      .eq("user_id", schedule.user_id)
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
          .eq("user_id", schedule.user_id);
      } catch {
        // Refresh failing isn't fatal on its own as long as the current
        // token hasn't actually expired yet — proceed with it this run
        // and try refreshing again next time.
      }
    }

    const { posts, imageUrl, textAttachment } = await generateStyledPost({
      supabase,
      creatorId: schedule.creator_id,
      topic: schedule.topic ?? undefined,
      postType: schedule.post_type as "single" | "thread",
      niche: schedule.niche,
      role: schedule.role_prompt,
      generateImage: Boolean(schedule.generate_image)
    });

    let threadsPostId: string;
    try {
      threadsPostId = await publishThreadPosts(
        settings.threads_api_user_id,
        accessToken,
        posts,
        imageUrl,
        textAttachment
      );
    } catch (publishErr) {
      // Generated content is real — save it as a failed draft rather than
      // silently losing it, then re-throw so the schedule itself is marked
      // errored too.
      await supabase.from("scheduled_posts").insert({
        user_id: schedule.user_id,
        creator_id: schedule.creator_id,
        posting_schedule_id: schedule.id,
        post_type: posts.length > 1 ? "thread" : "single",
        content_draft: posts,
        image_url: imageUrl,
        text_attachment: textAttachment,
        status: "failed",
        error_message: publishErr instanceof Error ? publishErr.message : "Publish failed"
      });
      throw publishErr;
    }

    await supabase.from("scheduled_posts").insert({
      user_id: schedule.user_id,
      creator_id: schedule.creator_id,
      posting_schedule_id: schedule.id,
      post_type: posts.length > 1 ? "thread" : "single",
      content_draft: posts,
      image_url: imageUrl,
      text_attachment: textAttachment,
      status: "posted",
      threads_post_id: threadsPostId,
      posted_at: new Date().toISOString()
    });

    await supabase
      .from("posting_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt,
        last_result: "success",
        last_error: null
      })
      .eq("id", schedule.id);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Schedule run failed";
    await supabase
      .from("posting_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt,
        last_result: "error",
        last_error: message
      })
      .eq("id", schedule.id);

    return { ok: false, error: message };
  }
}
