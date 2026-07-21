import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { publishThreadPosts, refreshLongLivedToken } from "@/lib/threads/publish";

// Module 4 — the actual "auto-post every N hours" tick. Triggered by
// server.js's internal setInterval (every 60s), never called directly by
// users. Protected by CRON_SECRET so the public URL can't be used to spam
// generation/publishing by anyone who finds it.
//
// For each posting_schedules row that's due: (1) make sure there's a valid
// (refreshing if needed) Threads API token for that schedule's owner,
// (2) generate a new styled post via Claude, (3) publish it for real via
// the official Threads API, (4) record the result and reschedule.
//
// Uses the service-role admin client throughout — this runs with no
// per-request user session, and needs to see every user's schedules, not
// just one, so RLS (which is correct and desired everywhere else in this
// app) doesn't apply here.

const REFRESH_MARGIN_MS = 5 * 24 * 60 * 60 * 1000; // refresh if <5 days from expiring

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (local/dev convenience)
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: dueSchedules, error: scheduleError } = await supabase
    .from("posting_schedules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", nowIso);

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 500 });
  }

  const results: Array<{ scheduleId: string; ok: boolean; error?: string }> = [];

  for (const schedule of dueSchedules ?? []) {
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
          // and try refreshing again on the next tick.
        }
      }

      const { posts } = await generateStyledPost({
        supabase,
        creatorId: schedule.creator_id,
        topic: schedule.topic ?? undefined,
        postType: schedule.post_type as "single" | "thread"
      });

      let threadsPostId: string;
      try {
        threadsPostId = await publishThreadPosts(settings.threads_api_user_id, accessToken, posts);
      } catch (publishErr) {
        // We did generate content — save it as a failed draft so it's not
        // silently lost, then re-throw so the schedule itself is marked
        // errored too.
        await supabase.from("scheduled_posts").insert({
          user_id: schedule.user_id,
          creator_id: schedule.creator_id,
          posting_schedule_id: schedule.id,
          post_type: posts.length > 1 ? "thread" : "single",
          content_draft: posts,
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

      results.push({ scheduleId: schedule.id, ok: true });
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

      results.push({ scheduleId: schedule.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
