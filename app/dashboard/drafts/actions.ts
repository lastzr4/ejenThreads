"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publishThreadPosts, ThreadsPartialPublishError } from "@/lib/threads/publish";
import { getValidThreadsAccessToken } from "@/lib/scheduler/get-threads-token";

export async function deleteDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const { error } = await supabase.from("scheduled_posts").delete().eq("id", id);

  if (error) {
    redirect(`/dashboard/drafts?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/drafts");
  redirect("/dashboard/drafts");
}

/**
 * Bulk cleanup for the whole Drafts tab — every row for this user,
 * regardless of status, including "posted" (real publish history). User
 * explicitly asked for posted rows to be clearable too, not just kept
 * forever — this does NOT touch the actual live posts on Threads, only
 * this app's local record of them.
 */
export async function clearDrafts() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("scheduled_posts").delete().eq("user_id", user.id);

  if (error) {
    redirect(`/dashboard/drafts?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/drafts");
  redirect("/dashboard/drafts?message=" + encodeURIComponent("Cleared all drafts"));
}

/**
 * The "review before it goes out" step (see ScheduleRow.require_approval
 * in lib/scheduler/process-schedule.ts): a schedule generates content and
 * stops at status "pending_review" without ever calling the Threads API.
 * This is what actually publishes it, once the user has looked it over
 * and clicked Approve & Post — same publish logic Schedules use
 * (publishThreadPosts), just triggered manually and later instead of
 * immediately after generation.
 */
export async function approveAndPublishDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: draft } = await supabase
    .from("scheduled_posts")
    .select("id, user_id, content_draft, image_url, text_attachment, status")
    .eq("id", id)
    .single();

  if (!draft) {
    redirect("/dashboard/drafts?error=Draft%20not%20found");
  }

  // Works for both a schedule-generated "pending_review" draft (the
  // approval-gate case) and a plain "draft" from the manual Generate post
  // button — either way this is the same "I've reviewed it, post it now"
  // action, just reached from two different origins.
  if (draft.status !== "pending_review" && draft.status !== "draft") {
    redirect(
      "/dashboard/drafts?error=" + encodeURIComponent("This post has already been published or failed")
    );
  }

  let errorMessage: string | null = null;

  try {
    const { threadsUserId, accessToken } = await getValidThreadsAccessToken(supabase, draft.user_id);
    const posts = Array.isArray(draft.content_draft) ? (draft.content_draft as string[]) : [];

    if (posts.length === 0) {
      throw new Error("No post text saved on this draft — nothing to publish");
    }

    const threadsPostId = await publishThreadPosts(
      threadsUserId,
      accessToken,
      posts,
      draft.image_url,
      draft.text_attachment
    );

    await supabase
      .from("scheduled_posts")
      .update({
        status: "posted",
        threads_post_id: threadsPostId,
        posted_at: new Date().toISOString(),
        error_message: null
      })
      .eq("id", id);
  } catch (err) {
    // Same partial-failure handling as the auto-publish path — the root
    // post can succeed even if a later reply in the chain fails.
    const isPartial = err instanceof ThreadsPartialPublishError;
    errorMessage = err instanceof Error ? err.message : "Publish failed";
    await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        threads_post_id: isPartial ? err.rootId : null,
        error_message: errorMessage
      })
      .eq("id", id);
  }

  revalidatePath("/dashboard/drafts");
  redirect(
    errorMessage
      ? `/dashboard/drafts?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/drafts?message=${encodeURIComponent("Published to Threads")}`
  );
}
