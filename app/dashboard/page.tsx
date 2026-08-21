import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  const userId = user?.id ?? "";

  // All independent of each other — run in parallel rather than paying for
  // five sequential round trips before the page can render anything.
  const [
    { count: totalCreators },
    { count: activeCreators },
    { data: analyzedRows },
    { count: draftsNeedingReview },
    { count: activeSchedules },
    { data: settings }
  ] = await Promise.all([
    supabase.from("creators").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("creators")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase.from("creator_analysis").select("creator_id"),
    supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .in("status", ["draft", "pending_review"]),
    supabase
      .from("posting_schedules")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("user_settings")
      .select("threads_session_updated_at, threads_api_username, threads_api_profile_picture_url")
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  const studiedCreators = new Set((analyzedRows ?? []).map((r) => r.creator_id)).size;
  const sessionConnected = Boolean(settings?.threads_session_updated_at);
  const apiUsername = settings?.threads_api_username as string | null;
  const apiAvatar = settings?.threads_api_profile_picture_url as string | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">At a glance — where things stand right now.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Threads connection</CardTitle>
          <CardDescription>Posts, replies, and schedules publish to this account.</CardDescription>
        </CardHeader>
        <CardContent>
          {apiUsername ? (
            <div className="flex items-center gap-3">
              {apiAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={apiAvatar} alt={apiUsername} className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-400">
                  ?
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-slate-900">@{apiUsername}</p>
                <p className="text-xs text-slate-500">
                  Threads API connected
                  {sessionConnected ? " · scraping session connected" : " · scraping runs anonymously"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-amber-700">
                Threads API not connected — Schedules and Auto-Comment can&apos;t publish yet.
              </p>
              <Link href="/dashboard/settings">
                <Button size="sm">Connect in Settings</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold text-slate-900">
              {studiedCreators}
              <span className="text-sm font-normal text-slate-400"> / {totalCreators ?? 0}</span>
            </p>
            <p className="text-xs text-slate-500">Creators studied ({activeCreators ?? 0} active)</p>
            <Link href="/dashboard/creators" className="mt-2 inline-block text-xs font-medium text-slate-600 hover:underline">
              View creators →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold text-slate-900">{draftsNeedingReview ?? 0}</p>
            <p className="text-xs text-slate-500">Drafts waiting for review</p>
            <Link href="/dashboard/drafts" className="mt-2 inline-block text-xs font-medium text-slate-600 hover:underline">
              Review drafts →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold text-slate-900">{activeSchedules ?? 0}</p>
            <p className="text-xs text-slate-500">Active schedules</p>
            <Link href="/dashboard/schedules" className="mt-2 inline-block text-xs font-medium text-slate-600 hover:underline">
              Manage schedules →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link href="/dashboard/creators">
            <Button>Generate post</Button>
          </Link>
          <Link href="/dashboard/tabur-link">
            <Button variant="outline">Tabur Link</Button>
          </Link>
          <Link href="/dashboard/image-generator">
            <Button variant="outline">Image Generator</Button>
          </Link>
          <Link href="/dashboard/performance">
            <Button variant="outline">Performance</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
