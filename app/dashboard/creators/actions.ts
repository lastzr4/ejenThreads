"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCreatorPosts } from "@/lib/threads/scraper";

function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

export async function addCreator(formData: FormData) {
  const username = cleanUsername(String(formData.get("username") ?? ""));
  if (!username) {
    redirect("/dashboard/creators?error=Username%20is%20required");
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("creators").insert({
    username,
    user_id: user.id
  });

  if (error) {
    redirect(`/dashboard/creators?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/creators");
  redirect("/dashboard/creators");
}

export async function deleteCreator(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const { error } = await supabase.from("creators").delete().eq("id", id);

  if (error) {
    redirect(`/dashboard/creators?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/creators");
  redirect("/dashboard/creators");
}

export async function fetchPostsForCreator(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const username = String(formData.get("username") ?? "");
  if (!id || !username) return;

  const supabase = createClient();
  // NOTE: redirect() throws internally, so it must never be called from
  // inside this try block — that would get swallowed by the catch below.
  // Collect an error message instead and redirect once, at the end.
  let errorMessage: string | null = null;

  try {
    const { posts } = await fetchCreatorPosts(username);

    if (posts.length > 0) {
      const rows = posts
        .filter((p) => p.platformPostId)
        .map((p) => ({
          creator_id: id,
          platform_post_id: p.platformPostId,
          post_url: p.postUrl,
          content_text: p.contentText,
          media_urls: p.mediaUrls,
          like_count: p.likeCount,
          reply_count: p.replyCount,
          repost_count: p.repostCount,
          share_count: p.shareCount,
          is_reply: p.isReply,
          parent_post_id: p.parentPostId,
          published_at: p.publishedAt,
          raw_data: p.raw
        }));

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("scraped_threads")
          .upsert(rows, { onConflict: "creator_id,platform_post_id" });

        if (insertError) {
          errorMessage = insertError.message;
        }
      }
    }

    if (!errorMessage) {
      await supabase
        .from("creators")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", id);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Scraper request failed";
  }

  revalidatePath(`/dashboard/creators/${id}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${id}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${id}`
  );
}
