import { createClient } from "@/lib/supabase/server";
import { createSchedule, toggleSchedule, deleteSchedule, runScheduleNow } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LocalDateTime } from "@/components/local-datetime";
import { NICHE_OPTIONS, nicheLabel } from "@/lib/niches";
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

  // None of these three depends on another's result — parallelizing avoids
  // three sequential round trips to Supabase on every visit to this page.
  const [{ data: creators }, { data: analyzedRows }, { data: schedules }] = await Promise.all([
    supabase.from("creators").select("id, username").order("username"),
    supabase.from("creator_analysis").select("creator_id"),
    supabase
      .from("posting_schedules")
      .select(
        "id, creator_id, interval_hours, post_type, topic, niche, role_prompt, generate_image, fixed_image_url, require_approval, is_active, next_run_at, last_run_at, last_result, last_error, creators(username)"
      )
      .order("created_at", { ascending: false })
  ]);

  const analyzedCreatorIds = new Set((analyzedRows ?? []).map((r) => r.creator_id));
  const studiedCreators = (creators ?? []).filter((c) => analyzedCreatorIds.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Schedules</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every interval, generates a new post in the chosen creator&apos;s style. By default it waits for
          your approval on the Drafts page before posting — untick &quot;Require my approval&quot; below to
          publish straight to Threads with no review step. Requires the Threads API connected in Settings.
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
                  Recurring topic (optional — e.g. a product name + affiliate link to keep tagging)
                </label>
                <input
                  type="text"
                  name="topic"
                  placeholder="Leave blank to let it pick fitting topics each time"
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
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Role / arahan khusus (optional) — overrides the format/structure every run, e.g. &quot;This
                  account is a professional short-story (cerpen) writer, ending each story with an affiliate
                  product plug.&quot;
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
                  Upload a fixed image (optional) — reused for every run instead of AI generation
                </label>
                <input
                  type="file"
                  name="fixedImage"
                  accept="image/*"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="generateImage" className="rounded border-slate-300" />
                  Generate an image every run too (AI, via Gemini — free, ignored if you upload a fixed image above)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    name="requireApproval"
                    defaultChecked
                    className="rounded border-slate-300"
                  />
                  Require my approval before posting (recommended) — review it on Drafts first
                </label>
              </div>
              <SubmitButton pendingText="Creating…">Create schedule</SubmitButton>
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
                      {nicheLabel(schedule.niche) && ` · Niche: ${nicheLabel(schedule.niche)}`}
                      {schedule.fixed_image_url
                        ? " · + fixed uploaded image"
                        : schedule.generate_image && " · + AI image"}
                      {" · "}
                      {schedule.require_approval ? "Needs your approval" : "Auto-publishes (no review)"}
                    </span>
                    {schedule.role_prompt && (
                      <span className="block italic text-slate-500">Role: {schedule.role_prompt}</span>
                    )}
                    {schedule.fixed_image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={schedule.fixed_image_url}
                        alt="Fixed image used every run"
                        className="mt-1 h-16 w-16 rounded-md border border-slate-200 object-cover"
                      />
                    )}
                    <span className="block">
                      Next run: <LocalDateTime iso={schedule.next_run_at} />
                      {schedule.last_run_at && (
                        <>
                          {" "}
                          · Last run: <LocalDateTime iso={schedule.last_run_at} />
                        </>
                      )}
                    </span>
                    {schedule.last_result === "error" && schedule.last_error && (
                      <span className="block text-red-600">Last error: {schedule.last_error}</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <form action={runScheduleNow}>
                    <input type="hidden" name="id" value={schedule.id} />
                    <SubmitButton variant="outline" size="sm" pendingText="Running…">
                      Run now
                    </SubmitButton>
                  </form>
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
