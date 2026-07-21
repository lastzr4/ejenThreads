import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPostsForCreator } from "../actions";
import { studyCreator } from "../analyze-actions";
import { generatePost } from "../generate-actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CreatorDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string; message?: string };
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

  const { data: analysis } = await supabase
    .from("creator_analysis")
    .select(
      "style_tone, hook_patterns, threading_structure, emoji_usage, cta_patterns, vocabulary_notes, generated_rules, sample_size, model_used, updated_at"
    )
    .eq("creator_id", creator.id)
    .maybeSingle();

  const totalPosts = posts?.length ?? 0;
  const totalReplies = (posts ?? []).reduce((sum, p) => sum + (p.reply_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/creators" className="text-sm text-slate-500 hover:underline">
          &larr; Creators
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold">@{creator.username}</h1>
          <div className="flex items-center gap-2">
            <form action={fetchPostsForCreator}>
              <input type="hidden" name="id" value={creator.id} />
              <input type="hidden" name="username" value={creator.username} />
              <SubmitButton pendingText="Fetching… (10-15s)">Fetch recent posts</SubmitButton>
            </form>
            <form action={studyCreator}>
              <input type="hidden" name="id" value={creator.id} />
              <SubmitButton pendingText="Studying…" variant="outline" disabled={totalPosts === 0}>
                Study
              </SubmitButton>
            </form>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {creator.last_scraped_at
            ? `Last scraped ${new Date(creator.last_scraped_at).toLocaleString()}`
            : "Not scraped yet — click Fetch recent posts."}
          {totalPosts > 0 && (
            <> · {totalPosts} post{totalPosts === 1 ? "" : "s"} scraped · {totalReplies} replies</>
          )}
        </p>
        {searchParams?.error && <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>}
        {searchParams?.message && <p className="mt-2 text-sm text-green-600">{searchParams.message}</p>}
      </div>

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Style analysis</CardTitle>
            <CardDescription>
              Based on {analysis.sample_size} post{analysis.sample_size === 1 ? "" : "s"} ·{" "}
              {analysis.model_used} · updated {new Date(analysis.updated_at).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-slate-700">Tone</p>
              <p className="text-slate-600">{analysis.style_tone}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Hooks</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.hook_patterns}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Structure</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.threading_structure}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Emoji usage</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.emoji_usage}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Calls to action</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.cta_patterns}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Vocabulary</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.vocabulary_notes}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Generated style guide</p>
              <p className="text-slate-600 whitespace-pre-wrap">{analysis.generated_rules}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate post</CardTitle>
            <CardDescription>
              Writes a brand-new post in @{creator.username}&apos;s studied style — not a copy of any
              real post. Saved as a draft under Drafts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generatePost} className="space-y-3">
              <input type="hidden" name="id" value={creator.id} />
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Topic (optional — e.g. a product, link, or idea to write about)
                </label>
                <textarea
                  name="topic"
                  rows={2}
                  placeholder="Leave blank to let it pick a topic that fits this creator's usual themes"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <select
                  name="postType"
                  defaultValue="single"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                >
                  <option value="single">Single post</option>
                  <option value="thread">Thread</option>
                </select>
                <SubmitButton pendingText="Generating…">Generate post</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

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
