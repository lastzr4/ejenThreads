import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { publishThreadPosts, publishCarouselPost, ThreadsPartialPublishError } from "@/lib/threads/publish";
import { getValidThreadsAccessToken } from "@/lib/scheduler/get-threads-token";

// Shared by both the cron tick (app/api/cron/run-schedules, iterates every
// due schedule across every user with the admin client) and the manual
// "Run now" button on the Schedules page (a single schedule, the owning
// user's own session-scoped client) — same generate-then-publish logic
// either way, just reused from two different callers/clients so it only
// lives in one place.

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
  /**
   * A user-uploaded image, set once at schedule-creation time (see
   * createSchedule in app/dashboard/schedules/actions.ts), reused on every
   * run of this schedule instead of AI generation — a schedule recurs with
   * no fresh file to upload each tick, so the same public Storage URL just
   * gets attached to every post. Takes priority over generate_image when set.
   */
  fixed_image_url?: string | null;
  /**
   * Same idea as fixed_image_url, but for a carousel schedule (post_type
   * "carousel") — 2-20 uploaded image URLs, set once at schedule-creation
   * time, reused as-is on every run instead of AI generation.
   */
  fixed_image_urls?: string[] | null;
  /**
   * How many images to AI-generate per run when post_type is "carousel"
   * and fixed_image_urls isn't set. Ignored for single/thread schedules.
   */
  carousel_image_count?: number | null;
  /**
   * When true (the default), a run only generates content and queues it
   * as a "pending_review" draft — nothing gets published until the user
   * approves it from the Drafts page (approveAndPublishDraft in
   * app/dashboard/drafts/actions.ts). When false, this behaves like the
   * original Module 4 design: generate and publish immediately, no review
   * step. Added after repeated real publish failures (permission errors,
   * content silently dropped) made "review before it goes out" something
   * worth having by default rather than fully trusting an unattended run.
   */
  require_approval?: boolean | null;
}

export interface ProcessScheduleResult {
  ok: boolean;
  error?: string;
}

/**
 * Generates a new styled post for one schedule. If the schedule requires
 * approval (the default), saves it as a "pending_review" draft and stops
 * there — no Threads API call happens until the user approves it. If not,
 * publishes immediately via the Threads API, same as the original design.
 * Either way, records the result and reschedules next_run_at — success or
 * failure either way (never throws; check the return value).
 */
export async function processSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  schedule: ScheduleRow
): Promise<ProcessScheduleResult> {
  const nextRunAt = new Date(Date.now() + schedule.interval_hours * 60 * 60 * 1000).toISOString();
  const requiresApproval = schedule.require_approval !== false;

  try {
    const isCarousel = schedule.post_type === "carousel";
    const hasFixedImage = !isCarousel && Boolean(schedule.fixed_image_url);
    const hasFixedImages = isCarousel && Array.isArray(schedule.fixed_image_urls) && schedule.fixed_image_urls.length >= 2;

    const {
      posts,
      imageUrl: aiImageUrl,
      imageUrls: aiImageUrls,
      imageError,
      textAttachment
    } = await generateStyledPost({
      supabase,
      creatorId: schedule.creator_id,
      topic: schedule.topic ?? undefined,
      postType: schedule.post_type as "single" | "thread" | "carousel",
      niche: schedule.niche,
      role: schedule.role_prompt,
      // Skip AI generation entirely when a fixed image (or fixed carousel
      // images) is set — it would just be thrown away below.
      generateImage: isCarousel
        ? Boolean(schedule.generate_image) && !hasFixedImages
        : Boolean(schedule.generate_image) && !hasFixedImage,
      carouselImageCount: schedule.carousel_image_count ?? 3
    });

    const imageUrl = isCarousel ? null : hasFixedImage ? (schedule.fixed_image_url as string) : aiImageUrl;
    const imageUrls = isCarousel ? (hasFixedImages ? (schedule.fixed_image_urls as string[]) : aiImageUrls) : null;
    const postType = isCarousel ? "carousel" : posts.length > 1 ? "thread" : "single";
    const usedFixedImage = isCarousel ? hasFixedImages : hasFixedImage;

    // A carousel with fewer than 2 images can't actually be published —
    // fail the run now (recorded as last_error on the schedule) rather
    // than saving a draft that can never go out.
    if (isCarousel && (!imageUrls || imageUrls.length < 2)) {
      throw new Error(imageError ?? "Carousel needs at least 2 images — upload some, or enable AI image generation.");
    }

    if (requiresApproval) {
      const { error: insertError } = await supabase.from("scheduled_posts").insert({
        user_id: schedule.user_id,
        creator_id: schedule.creator_id,
        posting_schedule_id: schedule.id,
        post_type: postType,
        content_draft: posts,
        image_url: imageUrl,
        image_urls: imageUrls,
        image_error: imageError,
        uploaded_image: usedFixedImage,
        text_attachment: textAttachment,
        status: "pending_review"
      });
      if (insertError) throw new Error(insertError.message);

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
    }

    // require_approval === false: publish immediately, same as the
    // original Module 4 behavior.
    const { threadsUserId, accessToken } = await getValidThreadsAccessToken(supabase, schedule.user_id);

    let threadsPostId: string;
    try {
      threadsPostId = isCarousel
        ? await publishCarouselPost(threadsUserId, accessToken, posts[0] ?? "", imageUrls as string[])
        : await publishThreadPosts(threadsUserId, accessToken, posts, imageUrl, textAttachment);
    } catch (publishErr) {
      // A ThreadsPartialPublishError means the root post genuinely went
      // live on Threads before something later in the chain (almost always
      // a reply) failed — record the real threads_post_id so the draft
      // links to the actual post instead of looking like nothing happened
      // at all. Any other error means nothing published. (Doesn't apply to
      // carousels — see publishCarouselPost's doc comment — but the same
      // generic handling below still works fine since isPartial is simply
      // always false there.)
      const isPartial = publishErr instanceof ThreadsPartialPublishError;
      await supabase.from("scheduled_posts").insert({
        user_id: schedule.user_id,
        creator_id: schedule.creator_id,
        posting_schedule_id: schedule.id,
        post_type: postType,
        content_draft: posts,
        image_url: imageUrl,
        image_urls: imageUrls,
        image_error: imageError,
        uploaded_image: usedFixedImage,
        text_attachment: textAttachment,
        status: "failed",
        threads_post_id: isPartial ? publishErr.rootId : null,
        error_message: publishErr instanceof Error ? publishErr.message : "Publish failed"
      });
      throw publishErr;
    }

    await supabase.from("scheduled_posts").insert({
      user_id: schedule.user_id,
      creator_id: schedule.creator_id,
      posting_schedule_id: schedule.id,
      post_type: postType,
      content_draft: posts,
      image_url: imageUrl,
      image_urls: imageUrls,
      image_error: imageError,
      uploaded_image: usedFixedImage,
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
