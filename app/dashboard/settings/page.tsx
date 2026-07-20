import { createClient } from "@/lib/supabase/server";
import { saveThreadsSession, clearThreadsSession } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: settings } = await supabase
    .from("user_settings")
    .select("threads_session_updated_at")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const connected = Boolean(settings?.threads_session_updated_at);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect a Threads session so Module 1 can scrape full post history
          instead of the ~3-4 post preview anonymous visitors get.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Threads session</CardTitle>
          <CardDescription>
            {connected ? (
              <>Connected — saved {new Date(settings!.threads_session_updated_at as string).toLocaleString()}.</>
            ) : (
              <>Not connected. Scraping runs anonymously (~3-4 posts per creator per fetch).</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
            <p className="font-medium">Before you paste anything here, read this:</p>
            <p>
              This connects scraping to a real Threads/Instagram account, run from
              this app&apos;s server (a different network than wherever you logged
              in). Meta can treat that as suspicious and force a re-login, a
              verification challenge, or restrict the account. Use an account
              you&apos;re comfortable putting at that risk — not your main
              personal one, ideally.
            </p>
            <p>
              This app never performs the login itself. You capture the session
              yourself, locally, by running{" "}
              <code className="rounded bg-amber-100 px-1">
                node scripts/capture-threads-session.mjs
              </code>{" "}
              on your own computer (see README &quot;Module 1&quot;), which opens a
              real browser window for you to log into directly. That produces a{" "}
              <code className="rounded bg-amber-100 px-1">threads-session-state.json</code>{" "}
              file — paste its full contents below.
            </p>
          </div>

          <form action={saveThreadsSession} className="space-y-3">
            <textarea
              name="sessionJson"
              rows={6}
              placeholder='{"cookies": [...], "origins": [...]}'
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
            />
            <div className="flex items-center gap-3">
              <SubmitButton pendingText="Saving…">
                {connected ? "Replace session" : "Save session"}
              </SubmitButton>
            </div>
          </form>

          {connected && (
            <form action={clearThreadsSession}>
              <Button variant="ghost" size="sm" type="submit">
                Disconnect
              </Button>
            </form>
          )}

          {searchParams?.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
          {searchParams?.message && <p className="text-sm text-green-600">{searchParams.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
