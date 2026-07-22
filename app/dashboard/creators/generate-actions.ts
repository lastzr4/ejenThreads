"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";

export async function generatePost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  const postType = formData.get("postType") === "thread" ? "thread" : "single";
  const niche = String(formData.get("niche") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const wantsImage = formData.get("generateImage") === "on";

  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let errorMessage: string | null = null;

  try {
    const { posts, imageUrl, imageError, textAttachment } = await generateStyledPost({
      supabase,
      creatorId: id,
      topic: topic || undefined,
      postType,
      niche: niche || undefined,
      role: role || undefined,
      generateImage: wantsImage
    });

    const { error: insertError } = await supabase.from("scheduled_posts").insert({
      user_id: user.id,
      creator_id: id,
      post_type: posts.length > 1 ? "thread" : "single",
      content_draft: posts,
      image_url: imageUrl,
      image_error: imageError,
      text_attachment: textAttachment,
      status: "draft"
    });

    if (insertError) {
      errorMessage = insertError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Post generation failed";
  }

  revalidatePath(`/dashboard/creators/${id}`);
  revalidatePath("/dashboard/drafts");
  redirect(
    errorMessage
      ? `/dashboard/creators/${id}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/drafts?message=${encodeURIComponent("New draft generated")}`
  );
}
