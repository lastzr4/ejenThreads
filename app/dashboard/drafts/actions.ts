"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publishThreadPosts, publishCarouselPost, ThreadsPartialPublishError } from "@/lib/threads/publish";
import { getValidThreadsAccessToken } from "@/lib/scheduler/get-threads-token";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";

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
 * Lets the user edit a draft's post text (and its long-form text_attachment,
 * if it has one) before publishing — for fixing a typo, shortening
 * something, or just not liking the AI's phrasing, without having to
 * regenerate the whole thing from scratch. Only allowed while the draft is
 * still unpublished ("draft" or "pending_review") — once it's posted or
 * failed, editing this row wouldn't change anything actually on Threads.
 */
export async function updateDraftContent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: draft } = await supabase
    .from("scheduled_posts")
    .select("id, status, post_type")
    .eq("id", id)
    .single();

  if (!draft) {
    redirect("/dashboard/drafts?error=Draft%20not%20found");
  }

  if (draft.status !== "draft" && draft.status !== "pending_review") {
    redirect(
      "/dashboard/drafts?error=" +
        encodeURIComponent("Only unpublished drafts can be edited")
    );
  }

  const posts = formData
    .getAll("posts")
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);

  if (posts.length === 0) {
    redirect(`/dashboard/drafts?error=${encodeURIComponent("Post text can't be empty")}`);
  }

  const textAttachmentRaw = formData.get("textAttachment");
  const textAttachment =
    typeof textAttachmentRaw === "string" && textAttachmentRaw.trim() ? textAttachmentRaw.trim() : null;

  // A carousel's post_type must stay "carousel" regardless of how many
  // caption items get edited here (it's a single caption, not a thread) —
  // only single/thread ever get recomputed from the edited post count.
  const post_type = draft.post_type === "carousel" ? "carousel" : posts.length > 1 ? "thread" : "single";

  const { error } = await supabase
    .from("scheduled_posts")
    .update({
      content_draft: posts,
      post_type,
      text_attachment: textAttachment
    })
    .eq("id", id);

  if (error) {
    redirect(`/dashboard/drafts?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/drafts");
  redirect(`/dashboard/drafts?message=${encodeURIComponent("Draft updated")}`);
}

/**
 * "Spin" — regenerates a fresh version of this draft's text (same creator
 * style, same topic/niche/role it was originally generated with, plus an
 * optional extra comment folded in as additional direction) without
 * starting over from the creator's page. Only rewrites content_draft/
 * text_attachment — the existing image (AI-made or uploaded) is left
 * untouched on purpose, so spinning the copy doesn't burn another Gemini
 * call or discard an image the user specifically uploaded. Only allowed on
 * still-unpublished drafts, same as Edit.
 */
export async function spinDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: draft } = await supabase
    .from("scheduled_posts")
    .select("id, creator_id, post_type, status, topic, niche, role_prompt, image_urls")
    .eq("id", id)
    .single();

  if (!draft) {
    redirect("/dashboard/drafts?error=Draft%20not%20found");
  }

  if (draft.status !== "draft" && draft.status !== "pending_review") {
    redirect("/dashboard/drafts?error=" + encodeURIComponent("Only unpublished drafts can be spun"));
  }

  if (!draft.creator_id) {
    redirect(
      "/dashboard/drafts?error=" +
        encodeURIComponent("This draft isn't linked to a creator anymore — can't regenerate it")
    );
  }

  let errorMessage: string | null = null;

  try {
    const postType: "single" | "thread" | "carousel" =
      draft.post_type === "carousel" ? "carousel" : draft.post_type === "thread" ? "thread" : "single";

    // The extra comment is folded into the Role instruction — same
    // mechanism a Role normally uses to override shape/framing — appended
    // after any Role this draft already had, or standing on its own if it
    // didn't have one.
    const baseRole = (draft.role_prompt ?? "").trim();
    const effectiveRole = comment
      ? baseRole
        ? `${baseRole}\n\nAdditional direction for this rewrite: ${comment}`
        : `Additional direction for this rewrite: ${comment}`
      : baseRole || undefined;

    const carouselImageCount =
      postType === "carousel" && Array.isArray(draft.image_urls) ? draft.image_urls.length : undefined;

    const { posts, textAttachment } = await generateStyledPost({
      supabase,
      creatorId: draft.creator_id,
      topic: draft.topic ?? undefined,
      postType,
      niche: draft.niche ?? undefined,
      role: effectiveRole,
      generateImage: false,
      carouselImageCount
    });

    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({
        content_draft: posts,
        text_attachment: textAttachment
      })
      .eq("id", id);

    if (updateError) {
      errorMessage = updateError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Spin failed";
  }

  revalidatePath("/dashboard/drafts");
  redirect(
    errorMessage
      ? `/dashboard/drafts?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/drafts?message=${encodeURIComponent("Generated a fresh version")}`
  );
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
    .select("id, user_id, content_draft, image_url, image_urls, text_attachment, status, post_type")
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

    const imageUrls = Array.isArray(draft.image_urls) ? (draft.image_urls as string[]) : [];
    const threadsPostId =
      draft.post_type === "carousel"
        ? await publishCarouselPost(threadsUserId, accessToken, posts[0] ?? "", imageUrls)
        : await publishThreadPosts(threadsUserId, accessToken, posts, draft.image_url, draft.text_attachment);

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
