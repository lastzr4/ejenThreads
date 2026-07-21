import { createClient } from "@/lib/supabase/server";
import { createSchedule, toggleSchedule, deleteSchedule } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const INTERVAL_OPTIONS = [
  { hours: 1, label: "Every 1 hour" },
  { hours: 2, label: "Every 2 hours" },
  { hours: 4, label: "Every 4 hours" },
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Every 24 hours (once a day)" }
];

export default async function SchedulesPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();

  const { data: creators } = await supabase.from("creators").select("id, username").order("username");

  const { data: analyzedRows } = await supabase.from("creator_analysis").select("creator_id");
  const analyzedCreatorIds = new Set((analyzedRows ?? []).map((r) => r.creator_id));
  const studiedCreators = (creators ?? []).filter((c) => analyzedCreatorIds.has(c.id));

  const { data: schedules } = await supabase
    .from("posting_schedules")
    .select(
      "id, creator_id, interval_hours, post_type, topic, is_active, next_run_at, last_run_at, last_result, last_error, creators(username)"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Schedules</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fully automated: every interval, generates a new post in the chosen creator&apos;s style and
          publishes it straight to your Threads account via the official API. Requires the Threads API
          connected in Settings.
        </p>
        {searchParams?.error && <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>}
        {searchParams?.message && <p className="mt-2 text-sm text-green-600">{searchParams.message}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New schedule</CardTitle>
          <CardDescription>
            Only creators you&apos;ve Studied show up here — that&apos;s what supplies the style.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {studiedCreators.length === 0 ? (
            <p className="text-sm text-slate-500">
              No studied creators yet — go to a creator&apos;s page, fetch posts, then click Study.
            </p>
          ) : (
            <form action={createSchedule} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Creator</label>
                  <select
                    name="creatorId"
                    required
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    {studiedCreators.map((c) => (
                      <option key={c.id} value={c.id}>
                        @{c.username}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Interval</label>
                  <select
                    name="intervalHours"
                    defaultValue="4"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.hours} value={opt.hours}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Recurring topic (optional — e.g. an affiliate niche/product to keep writing about)
                </label>
                <input
                  type="text"
                  name="topic"
                  placeholder="Leave blank to let it pick fitting topics each time"
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
                <SubmitButton pendingText="Creating…">Create schedule</SubmitButton>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {schedules && schedules.length > 0 ? (
          schedules.map((schedule) => {
            const creatorUsername = (schedule.creators as unknown as { username: string } | null)?.username;
            return (
              <Card key={schedule.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      @{creatorUsername ?? "unknown"} ·{" "}
                      {INTERVAL_OPTIONS.find((o) => o.hours === schedule.interval_hours)?.label ??
                        `Every ${schedule.interval_hours}h`}
                    </CardTitle>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        schedule.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {schedule.is_active ? "Active" : "Paused"}
                    </span>
                  </div>
                  <CardDescription className="space-y-1">
                    <span className="block">
                      {schedule.post_type === "thread" ? "Thread" : "Single post"}
                      {schedule.topic ? ` · Topic: ${schedule.topic}` : " · Auto-picked topics"}
                    </span>
                    <span className="block">
                      Next run: {new Date(schedule.next_run_at).toLocaleString()}
                      {schedule.last_run_at && (
                        <> · Last run: {new Date(schedule.last_run_at).toLocaleString()}</>
                      )}
                    </span>
                    {schedule.last_result === "error" && schedule.last_error && (
                      <span className="block text-red-600">Last error: {schedule.last_error}</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <form action={toggleSchedule}>
                    <input type="hidden" name="id" value={schedule.id} />
                    <input type="hidden" name="isActive" value={String(schedule.is_active)} />
                    <Button variant="outline" size="sm" type="submit">
                      {schedule.is_active ? "Pause" : "Resume"}
                    </Button>
                  </form>
                  <form action={deleteSchedule}>
                    <input type="hidden" name="id" value={schedule.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">No schedules yet.</p>
        )}
      </div>
    </div>
  );
}
