import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteDraft } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CopyDraftButton } from "@/components/copy-draft-button";

export default async function DraftsPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();

  const { data: drafts } = await supabase
    .from("scheduled_posts")
    .select("id, post_type, content_draft, status, created_at, creators(username)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Drafts</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI-generated posts, written in a studied creator&apos;s style. Review, copy, or discard —
          scheduling/auto-posting (Module 4) isn&apos;t wired up yet, so these are ready to paste
          manually for now.
        </p>
        {searchParams?.error && <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>}
        {searchParams?.message && <p className="mt-2 text-sm text-green-600">{searchParams.message}</p>}
      </div>

      <div className="space-y-3">
        {drafts && drafts.length > 0 ? (
          drafts.map((draft) => {
            const posts = Array.isArray(draft.content_draft) ? (draft.content_draft as string[]) : [];
            const creatorUsername = (draft.creators as unknown as { username: string } | null)?.username;

            return (
              <Card key={draft.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {draft.post_type === "thread" ? `Thread (${posts.length} posts)` : "Single post"}
                    </CardTitle>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {draft.status}
                    </span>
                  </div>
                  <CardDescription>
                    {creatorUsername ? (
                      <>
                        Styled after{" "}
                        <Link href="/dashboard/creators" className="hover:underline">
                          @{creatorUsername}
                        </Link>{" "}
                        ·{" "}
                      </>
                    ) : null}
                    {new Date(draft.created_at).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    {posts.map((text, i) => (
                      <p
                        key={i}
                        className="whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-3 text-sm"
                      >
                        {text}
                      </p>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyDraftButton posts={posts} />
                    <form action={deleteDraft}>
                      <input type="hidden" name="id" value={draft.id} />
                      <Button variant="ghost" size="sm" type="submit">
                        Delete
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">
            No drafts yet — go to a creator you&apos;ve studied and click Generate post.
          </p>
        )}
      </div>
    </div>
  );
}
