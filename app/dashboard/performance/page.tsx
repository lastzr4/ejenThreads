import { createClient } from "@/lib/supabase/server";
import { refreshPerformanceAnalysis, syncMetricsNow } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { LocalDateTime } from "@/components/local-datetime";
import { hookTypeLabels } from "@/lib/hook-types";
import { nicheLabel } from "@/lib/niches";
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
      .limit(50)
  ]);

  const syncedCount = (posts ?? []).filter((p) => p.metrics_updated_at).length;

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
          <CardDescription>Most recent first. Metrics sync automatically every so often after posting.</CardDescription>
        </CardHeader>
        <CardContent>
          {!posts || posts.length === 0 ? (
            <p className="text-sm text-slate-500">No published posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Post</th>
                    <th className="py-2 pr-3 font-medium">Hook</th>
                    <th className="py-2 pr-3 font-medium">Niche</th>
                    <th className="py-2 pr-3 font-medium">Posted</th>
                    <th className="py-2 pr-3 text-right font-medium">Reach</th>
                    <th className="py-2 pr-3 text-right font-medium">Likes</th>
                    <th className="py-2 pr-3 text-right font-medium">Comments</th>
                    <th className="py-2 pr-3 text-right font-medium">Shares</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => {
                    const username = (p.creators as unknown as { username: string } | null)?.username;
                    const text = Array.isArray(p.content_draft) ? (p.content_draft as string[]).join(" / ") : "";
                    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
                    const hooks = hookTypeLabels(p.hook_types as string[] | null).join(", ");
                    return (
                      <tr key={p.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <p className="text-slate-700">{preview || "(no text)"}</p>
                          <p className="text-slate-400">
                            @{username ?? "unknown"} · {p.post_type}
                          </p>
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{hooks || "—"}</td>
                        <td className="py-2 pr-3 text-slate-600">{nicheLabel(p.niche as string | null) ?? "—"}</td>
                        <td className="py-2 pr-3 text-slate-500">
                          {p.posted_at ? <LocalDateTime iso={p.posted_at as string} /> : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_views ?? "—"}</td>
                        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_likes ?? "—"}</td>
                        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_replies ?? "—"}</td>
                        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_shares ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
