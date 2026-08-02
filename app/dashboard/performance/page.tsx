import { createClient } from "@/lib/supabase/server";
import { refreshPerformanceAnalysis, syncMetricsNow } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { LocalDateTime } from "@/components/local-datetime";
import { PerformancePostsTable, type PerformancePostRow } from "@/components/performance-posts-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PerformancePage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [{ data: insights }, { data: posts }] = await Promise.all([
    supabase.from("performance_insights").select("*").eq("user_id", user?.id ?? "").maybeSingle(),
    supabase
      .from("scheduled_posts")
      .select(
        `id, content_draft, post_type, niche, hook_types, posted_at, metrics_updated_at, metric_views,
        metric_likes, metric_replies, metric_reposts, metric_quotes, metric_shares, creators(username)`
      )
      .eq("user_id", user?.id ?? "")
      .eq("status", "posted")
      .order("posted_at", { ascending: false })
      // Effectively "all" — a generous safety cap rather than a real limit;
      // one user's own posted-post history isn't going to realistically
      // exceed this. Sorting/Top-10 (see PerformancePostsTable) happens
      // client-side over whatever comes back here.
      .limit(1000)
  ]);

  const syncedCount = (posts ?? []).filter((p) => p.metrics_updated_at).length;

  const postRows: PerformancePostRow[] = (posts ?? []).map((p) => ({
    id: p.id as string,
    content_draft: p.content_draft as string[] | null,
    post_type: p.post_type as string,
    niche: p.niche as string | null,
    hook_types: p.hook_types as string[] | null,
    posted_at: p.posted_at as string | null,
    metric_views: p.metric_views as number | null,
    metric_likes: p.metric_likes as number | null,
    metric_replies: p.metric_replies as number | null,
    metric_shares: p.metric_shares as number | null,
    username: (p.creators as unknown as { username: string } | null)?.username ?? null
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Past performance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real engagement from posts this app published to Threads — Reach (views), Likes, Comments
          (replies), and Shares — analyzed to show which hook/niche/timing choices actually work, and fed
          back into future post generation automatically.
        </p>
        {searchParams?.error && <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>}
        {searchParams?.message && <p className="mt-2 text-sm text-green-600">{searchParams.message}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI analysis</CardTitle>
          <CardDescription>
            {insights ? (
              <>
                Based on {insights.based_on_post_count} post(s) · updated{" "}
                <LocalDateTime iso={insights.generated_at as string} />
              </>
            ) : (
              "No analysis generated yet."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <form action={syncMetricsNow} className="flex flex-col items-start gap-1">
              <SubmitButton variant="outline" size="sm" pendingText="Syncing…">
                Sync metrics now
              </SubmitButton>
              <PendingBanner message="Fetching latest engagement numbers from Threads for recent posts." />
            </form>
            <form action={refreshPerformanceAnalysis} className="flex flex-col items-start gap-1">
              <SubmitButton size="sm" pendingText="Analyzing…">
                Refresh analysis
              </SubmitButton>
              <PendingBanner message="Analyzing your posts with Claude — usually a few seconds." />
            </form>
            <span className="text-xs text-slate-500">
              {syncedCount} of {posts?.length ?? 0} posted post(s) have synced metrics (need at least 5 to
              analyze).
            </span>
          </div>

          {insights ? (
            <div className="space-y-3 border-t border-slate-100 pt-3 text-sm">
              <div>
                <p className="font-medium text-slate-700">Summary</p>
                <p className="whitespace-pre-wrap text-slate-600">{insights.summary}</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">What&apos;s working</p>
                <p className="whitespace-pre-wrap text-slate-600">{insights.best_patterns}</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">What&apos;s not working</p>
                <p className="whitespace-pre-wrap text-slate-600">{insights.worst_patterns}</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">Timing</p>
                <p className="whitespace-pre-wrap text-slate-600">{insights.timing_notes}</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">Recommendations</p>
                <p className="whitespace-pre-wrap text-slate-600">{insights.recommendations}</p>
              </div>
              <p className="text-xs text-slate-400">
                These recommendations are automatically folded into future Generate/Schedule/Spin posts —
                no extra setup needed.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Publish some posts, let metrics sync (automatic — or use &quot;Sync metrics now&quot; above),
              then click &quot;Refresh analysis&quot; once at least 5 have synced engagement numbers.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posted posts &amp; metrics</CardTitle>
          <CardDescription>
            Top 10 by whichever metric you pick, plus every posted post below — click a column to sort that
            one too. Metrics sync automatically every so often after posting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PerformancePostsTable posts={postRows} />
        </CardContent>
      </Card>
    </div>
  );
}
