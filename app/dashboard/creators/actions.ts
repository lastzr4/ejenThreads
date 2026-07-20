"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCreatorPosts, type NormalizedThreadsPost } from "@/lib/threads/scraper";

function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

/**
 * The scraper's DOM fallback (see lib/threads/scraper.ts) may not find an
 * explicit post id or URL. Rather than silently dropping those rows (the
 * table requires platform_post_id), derive a stable id from the content
 * itself — same post content always hashes to the same id, so re-fetching
 * still dedupes correctly via the upsert below.
 */
function resolvePostId(post: NormalizedThreadsPost): string | null {
  if (post.platformPostId) return post.platformPostId;
  if (!post.contentText) return null;
  return "hash_" + createHash("sha256").update(post.contentText).digest("hex").slice(0, 32);
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

  // Always captured and saved to creators.last_fetch_debug, whether the
  // scrape succeeds, finds zero posts, or throws — so a failed/empty
  // attempt is debuggable via the Supabase table editor (or a connected
  // Supabase MCP) without needing another round of guessing.
  let debugPayload: unknown = null;

  // Load a connected Threads session, if any (see app/dashboard/settings),
  // so authenticated users get full post history instead of the anonymous
  // ~3-4 post preview. Missing/null is fine — fetchCreatorPosts falls back
  // to anonymous scraping.
  const {
    data: { user: currentUser }
  } = await supabase.auth.getUser();
  const { data: settingsRow } = currentUser
    ? await supabase
        .from("user_settings")
        .select("threads_session_state")
        .eq("user_id", currentUser.id)
        .maybeSingle()
    : { data: null };
  const sessionState = (settingsRow?.threads_session_state as Record<string, unknown> | null) ?? null;

  try {
    const { posts, raw } = await fetchCreatorPosts(username, sessionState);
    debugPayload = { postsFound: posts.length, raw };

    if (posts.length > 0) {
      const withIds = posts
        .map((p) => ({ ...p, resolvedId: resolvePostId(p) }))
        .filter((p) => p.resolvedId);

      // Postgres rejects an upsert batch containing two rows with the same
      // conflict target ("ON CONFLICT DO UPDATE command cannot affect row
      // a second time") — e.g. the DOM extractor can pick up the same post
      // twice (a reply nested inside its parent's container can separately
      // match the byline+time pattern). Keep the first occurrence of each
      // platform_post_id so the batch is safe to upsert regardless of why
      // the duplicate happened.
      const dedupedById = new Map<string, (typeof withIds)[number]>();
      for (const p of withIds) {
        if (!dedupedById.has(p.resolvedId as string)) {
          dedupedById.set(p.resolvedId as string, p);
        }
      }

      const rows = Array.from(dedupedById.values()).map((p) => ({
        creator_id: id,
        platform_post_id: p.resolvedId,
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
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Scraper request failed";
    debugPayload = { error: errorMessage };
  }

  await supabase
    .from("creators")
    .update({
      last_scraped_at: new Date().toISOString(),
      last_fetch_debug: debugPayload
    })
    .eq("id", id);

  revalidatePath(`/dashboard/creators/${id}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${id}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${id}`
  );
}
