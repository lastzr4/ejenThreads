import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPostsForCreator } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";

export default async function CreatorDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const supabase = createClient();

  const { data: creator } = await supabase
    .from("creators")
    .select("id, username, last_scraped_at")
    .eq("id", params.id)
    .single();

  if (!creator) {
    notFound();
  }

  const { data: posts } = await supabase
    .from("scraped_threads")
    .select("id, content_text, like_count, reply_count, repost_count, published_at, post_url")
    .eq("creator_id", creator.id)
    .order("published_at", { ascending: false, nullsFirst: false });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/creators" className="text-sm text-slate-500 hover:underline">
          &larr; Creators
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold">@{creator.username}</h1>
          <form action={fetchPostsForCreator}>
            <input type="hidden" name="id" value={creator.id} />
            <input type="hidden" name="username" value={creator.username} />
            <SubmitButton pendingText="Fetching… (10-15s)">Fetch recent posts</SubmitButton>
          </form>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {creator.last_scraped_at
            ? `Last scraped ${new Date(creator.last_scraped_at).toLocaleString()}`
            : "Not scraped yet — click Fetch recent posts."}
        </p>
        {searchParams?.error && (
          <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>
        )}
      </div>

      <div className="space-y-3">
        {posts && posts.length > 0 ? (
          posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="space-y-2 p-4">
                <p className="whitespace-pre-wrap text-sm">{post.content_text}</p>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>{post.like_count} likes</span>
                  <span>{post.reply_count} replies</span>
                  <span>{post.repost_count} reposts</span>
                  {post.published_at && (
                    <span>{new Date(post.published_at).toLocaleDateString()}</span>
                  )}
                  {post.post_url && (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      View on Threads
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-slate-500">
            No posts scraped yet for this creator.
          </p>
        )}
      </div>
    </div>
  );
}
