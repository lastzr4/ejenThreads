import { createClient } from "@/lib/supabase/server";
import { saveThreadsSession, clearThreadsSession, disconnectThreadsApi } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LocalDateTime } from "@/components/local-datetime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();
  // getSession() instead of getUser() — middleware already did the
  // server-verified auth check for this request; reading the session from
  // the cookie here avoids a second network round trip to Supabase Auth
  // just to get the user id for the query below.
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      "threads_session_updated_at, threads_api_user_id, threads_api_token_expires_at, threads_api_connected_at"
    )
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const connected = Boolean(settings?.threads_session_updated_at);
  const apiConnected = Boolean(settings?.threads_api_user_id);
  const apiTokenExpiresAt = settings?.threads_api_token_expires_at
    ? new Date(settings.threads_api_token_expires_at as string)
    : null;
  const apiTokenExpiringSoon = apiTokenExpiresAt
    ? apiTokenExpiresAt.getTime() - Date.now() < 5 * 24 * 60 * 60 * 1000
    : false;

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
              <>
                Connected — saved <LocalDateTime iso={settings!.threads_session_updated_at as string} />.
              </>
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
              yourself, locally, on your own computer.
            </p>
          </div>

          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
            <p className="font-medium">How to connect:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                In your project folder, double-click{" "}
                <code className="rounded bg-slate-100 px-1">capture-threads-session.bat</code>{" "}
                to start.
              </li>
              <li>A real Chromium window opens — log into Threads exactly as you normally would.</li>
              <li>Once you&apos;re on your home feed, go back to that window and press Enter.</li>
              <li>
                Open the <code className="rounded bg-slate-100 px-1">threads-session-state.json</code>{" "}
                file it creates, copy everything inside it, and paste it below.
              </li>
            </ol>
            <p className="pt-1 text-slate-500">
              (Not on Windows, or prefer the terminal? Run{" "}
              <code className="rounded bg-slate-100 px-1">
                node scripts/capture-threads-session.mjs
              </code>{" "}
              instead — same result.)
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Threads API (auto-posting)</CardTitle>
          <CardDescription>
            {apiConnected ? (
              <>
                Connected — token{" "}
                {apiTokenExpiresAt ? (
                  <>
                    valid until <LocalDateTime iso={settings!.threads_api_token_expires_at as string} />
                    {apiTokenExpiringSoon && " (refreshes automatically soon)"}
                  </>
                ) : (
                  "connected"
                )}
                .
              </>
            ) : (
              <>Not connected. Schedules (Module 4) can&apos;t publish until this is connected.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
            <p>
              This is the official Meta Threads API — a separate, sanctioned connection from the
              scraping session above. It requires a one-time Meta Developer App setup (see README
              &quot;Module 4&quot;) before this button will work:{" "}
              <code className="rounded bg-slate-100 px-1">THREADS_APP_ID</code>,{" "}
              <code className="rounded bg-slate-100 px-1">THREADS_APP_SECRET</code>, and{" "}
              <code className="rounded bg-slate-100 px-1">THREADS_REDIRECT_URI</code> set in Railway
              → Variables.
            </p>
            <p>
              As long as you&apos;re only posting to your own account, Meta&apos;s Standard access
              level is enough — no app review or business verification needed.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a href="/api/threads/oauth/start">
              <Button type="button" variant={apiConnected ? "outline" : "default"}>
                {apiConnected ? "Reconnect" : "Connect with Threads"}
              </Button>
            </a>
            {apiConnected && (
              <form action={disconnectThreadsApi}>
                <Button variant="ghost" size="sm" type="submit">
                  Disconnect
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
