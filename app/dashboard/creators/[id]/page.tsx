import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPostsForCreator } from "../actions";
import { studyCreator } from "../analyze-actions";
import { generatePost } from "../generate-actions";
import { uploadKnowledgeBase, addKnowledgeBaseFromUrl, clearKnowledgeBase } from "../knowledge-actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { Button } from "@/components/ui/button";
import { LocalDateTime } from "@/components/local-datetime";
import { NICHE_OPTIONS } from "@/lib/niches";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CreatorDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();

  // All three queries key off params.id (creator_id === creators.id), so
  // none actually depends on another's result — running them in parallel
  // instead of one-after-another cuts this page's data-fetch time to
  // roughly the slowest single query instead of the sum of all three.
  const [{ data: creator }, { data: posts }, { data: analysis }] = await Promise.all([
    supabase
      .from("creators")
      .select(
        "id, username, last_scraped_at, knowledge_base_text, knowledge_base_filename, knowledge_base_updated_at"
      )
      .eq("id", params.id)
      .single(),
    supabase
      .from("scraped_threads")
      .select("id, content_text, like_count, reply_count, repost_count, published_at, post_url")
      .eq("creator_id", params.id)
      .order("published_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("creator_analysis")
      .select(
        "style_tone, hook_patterns, threading_structure, emoji_usage, cta_patterns, vocabulary_notes, generated_rules, sample_size, model_used, updated_at"
      )
      .eq("creator_id", params.id)
      .maybeSingle()
  ]);

  if (!creator) {
    notFound();
  }

  const totalPosts = posts?.length ?? 0;
  const totalReplies = (posts ?? []).reduce((sum, p) => sum + (p.reply_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/creators" className="text-sm text-slate-500 hover:underline">
          &larr; Creators
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-xl font-semibold">@{creator.username}</h1>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <form action={fetchPostsForCreator} className="flex flex-col items-start gap-1">
              <input type="hidden" name="id" value={creator.id} />
              <input type="hidden" name="username" value={creator.username} />
              <SubmitButton pendingText="Fetching…">Fetch recent posts</SubmitButton>
              <PendingBanner message="Scrolling and collecting posts — can take up to 30 seconds." />
            </form>
            <form action={studyCreator} className="flex flex-col items-start gap-1">
              <input type="hidden" name="id" value={creator.id} />
              <SubmitButton pendingText="Studying…" variant="outline" disabled={totalPosts === 0}>
                Study
              </SubmitButton>
              <PendingBanner message="Analyzing style with Claude — usually just a few seconds." />
            </form>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {creator.last_scraped_at ? (
            <>
              Last scraped <LocalDateTime iso={creator.last_scraped_at} />
            </>
          ) : (
            "Not scraped yet — click Fetch recent posts."
          )}
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
              {analysis.model_used} · updated <LocalDateTime iso={analysis.updated_at} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Knowledge base (optional)</CardTitle>
          <CardDescription>
            Upload a PDF, or paste a webpage URL, for this creator — AI reads it and generated posts can
            draw on and revolve around its content (e.g. a product catalog, an ebook, a set of notes, an
            article). Adding a new one replaces whatever was there before — this holds one reference
            source per creator, not a library.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {creator.knowledge_base_filename ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
              <div>
                <p className="font-medium text-slate-700 break-all">{creator.knowledge_base_filename}</p>
                <p className="text-xs text-slate-500">
                  Updated <LocalDateTime iso={creator.knowledge_base_updated_at} />
                </p>
              </div>
              <form action={clearKnowledgeBase}>
                <input type="hidden" name="creatorId" value={creator.id} />
                <Button variant="ghost" size="sm" type="submit">
                  Remove
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No knowledge base added yet for this creator.</p>
          )}
          <form action={uploadKnowledgeBase} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="creatorId" value={creator.id} />
            <input
              type="file"
              name="knowledgeFile"
              accept="application/pdf"
              required
              className="block flex-1 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            <SubmitButton size="sm" pendingText="Reading PDF…">
              {creator.knowledge_base_filename ? "Replace with PDF" : "Upload PDF"}
            </SubmitButton>
          </form>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <form action={addKnowledgeBaseFromUrl} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="creatorId" value={creator.id} />
            <input
              type="url"
              name="knowledgeUrl"
              placeholder="https://example.com/some-article"
              required
              className="w-full flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
            />
            <SubmitButton size="sm" pendingText="Fetching page…">
              {creator.knowledge_base_filename ? "Replace with URL" : "Fetch URL"}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

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
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Niche (optional)</label>
                  <select
                    name="niche"
                    defaultValue=""
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    {NICHE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Format</label>
                  <select
                    name="postType"
                    defaultValue="single"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    <option value="single">Single post</option>
                    <option value="thread">Thread</option>
                    <option value="carousel">Carousel (multi-image)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Role / arahan khusus (optional) — overrides the format/structure, e.g. &quot;This account is
                  a professional short-story (cerpen) writer, ending each story with an affiliate product
                  plug.&quot;
                </label>
                <textarea
                  name="role"
                  rows={3}
                  placeholder="Leave blank to just use this creator's usual post format"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Upload your own image (optional, Single/Thread only) — used instead of AI generation if
                  provided
                </label>
                <input
                  type="file"
                  name="uploadedImage"
                  accept="image/*"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3 space-y-3">
                <p className="text-xs font-medium text-slate-600">Carousel format only (ignored otherwise)</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Upload your own images (2-20) — used instead of AI generation if provided
                  </label>
                  <input
                    type="file"
                    name="carouselImages"
                    accept="image/*"
                    multiple
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Number of AI images to generate (if not uploading your own above)
                  </label>
                  <select
                    name="carouselImageCount"
                    defaultValue="3"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 sm:w-40"
                  >
                    {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} images
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="generateImage" className="rounded border-slate-300" />
                  Generate image(s) with AI (Gemini — free; ignored if you uploaded your own above)
                </label>
                <SubmitButton pendingText="Generating…">Generate post</SubmitButton>
              </div>
              <PendingBanner message="Writing your post with Claude — longer if generating an image too (up to ~20 seconds total). This new draft will show up on the Drafts page when it's done." />
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
                    <span>
                      <LocalDateTime iso={post.published_at} dateOnly />
                    </span>
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
