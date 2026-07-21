"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";

export async function generatePost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  const postType = formData.get("postType") === "thread" ? "thread" : "single";

  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let errorMessage: string | null = null;

  try {
    const { posts } = await generateStyledPost({ supabase, creatorId: id, topic: topic || undefined, postType });

    const { error: insertError } = await supabase.from("scheduled_posts").insert({
      user_id: user.id,
      creator_id: id,
      post_type: posts.length > 1 ? "thread" : "single",
      content_draft: posts,
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
