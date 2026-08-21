import { createClient } from "@/lib/supabase/server";
import { saveThreadsSession, clearThreadsSession, disconnectThreadsApi, updateAutoCommentSettings } from "./actions";
import { cleanupUnusedGeneratedImages } from "./cleanup-actions";
import { addProductPhoto, deleteProductPhoto } from "./product-photo-actions";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalDateTime } from "@/components/local-datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      `threads_session_updated_at, threads_api_user_id, threads_api_token_expires_at, threads_api_connected_at,
      threads_api_username, threads_api_name, threads_api_profile_picture_url,
      auto_comment_enabled, auto_comment_daily_limit, auto_comment_delay_min_minutes,
      auto_comment_delay_max_minutes, auto_comment_count_today, auto_comment_count_reset_at`
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
  const apiUsername = settings?.threads_api_username as string | null;
  const apiName = settings?.threads_api_name as string | null;
  const apiProfilePictureUrl = settings?.threads_api_profile_picture_url as string | null;

  const { count: activeCreatorCount } = await supabase
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user?.id ?? "")
    .eq("is_active", true);

  const { data: recentComments } = await supabase
    .from("commented_posts")
    .select("id, post_permalink, post_excerpt, comment_text, status, error_message, created_at, creators(username)")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(8);

  const { data: productPhotos } = await supabase
    .from("shopee_product_photos")
    .select("id, product_id, source_url, image_url, title, created_at")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: false });

  const autoCommentEnabled = Boolean(settings?.auto_comment_enabled);
  const autoCommentDailyLimit = (settings?.auto_comment_daily_limit as number) ?? 10;
  const autoCommentDelayMin = (settings?.auto_comment_delay_min_minutes as number) ?? 5;
  const autoCommentDelayMax = (settings?.auto_comment_delay_max_minutes as number) ?? 10;
  const autoCommentCountToday = (settings?.auto_comment_count_today as number) ?? 0;

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
            <div>
              <Label htmlFor="sessionJson" className="mb-1 block text-xs font-medium text-slate-600">
                Session JSON
              </Label>
              <Textarea
                id="sessionJson"
                name="sessionJson"
                rows={6}
                placeholder='{"cookies": [...], "origins": [...]}'
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton pendingText="Saving…">
                {connected ? "Replace session" : "Save session"}
              </SubmitButton>
            </div>
          </form>

          {connected && (
            <form action={clearThreadsSession}>
              <ConfirmSubmitButton
                variant="destructive"
                size="sm"
                pendingText="Disconnecting…"
                confirmMessage="Disconnect this Threads session? Scraping will fall back to anonymous (~3-4 posts per creator) until you reconnect."
              >
                Disconnect
              </ConfirmSubmitButton>
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
          {apiConnected && (
            <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
              {apiProfilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={apiProfilePictureUrl}
                  alt={apiUsername ?? "Connected account"}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-400">
                  ?
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {apiUsername ? `@${apiUsername}` : "Unknown account"}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {apiName ? `${apiName} · ` : ""}All posts, replies, and schedules below publish here.
                </p>
              </div>
            </div>
          )}

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
                <ConfirmSubmitButton
                  variant="destructive"
                  size="sm"
                  pendingText="Disconnecting…"
                  confirmMessage="Disconnect the Threads API? Schedules and Auto-Comment can't publish until you reconnect."
                >
                  Disconnect
                </ConfirmSubmitButton>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Comment</CardTitle>
          <CardDescription>
            AI writes a short, friendly reply to posts from your tracked creators (Dashboard → Creators),
            published via the official Threads API&apos;s reply feature — the same connection above, not
            browser automation, and never your own personal feed. Only public creators you&apos;ve
            already added and left active are ever targeted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!apiConnected && (
            <p className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              Connect the Threads API above first — Auto-Comment publishes through the same connection.
            </p>
          )}
          {apiConnected && !activeCreatorCount && (
            <p className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              No active tracked creators yet — add one in Dashboard → Creators first, there&apos;s nothing
              to comment on otherwise.
            </p>
          )}

          <form action={updateAutoCommentSettings} className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={autoCommentEnabled} className="h-4 w-4" />
              Enable Auto-Comment
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="dailyLimit" className="mb-1 block text-xs font-medium text-slate-600">
                  Daily limit (comments/day)
                </Label>
                <Input
                  id="dailyLimit"
                  type="number"
                  name="dailyLimit"
                  min={1}
                  max={200}
                  defaultValue={autoCommentDailyLimit}
                />
              </div>
              <div>
                <Label htmlFor="delayMin" className="mb-1 block text-xs font-medium text-slate-600">
                  Min delay (minutes)
                </Label>
                <Input
                  id="delayMin"
                  type="number"
                  name="delayMin"
                  min={1}
                  max={1440}
                  defaultValue={autoCommentDelayMin}
                />
              </div>
              <div>
                <Label htmlFor="delayMax" className="mb-1 block text-xs font-medium text-slate-600">
                  Max delay (minutes)
                </Label>
                <Input
                  id="delayMax"
                  type="number"
                  name="delayMax"
                  min={1}
                  max={1440}
                  defaultValue={autoCommentDelayMax}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              A random wait between the min and max is used after every comment, so replies go out spaced
              apart instead of back-to-back. {autoCommentEnabled && (
                <>
                  Used <strong>{autoCommentCountToday}</strong> of <strong>{autoCommentDailyLimit}</strong>{" "}
                  today so far.
                </>
              )}
            </p>
            <SubmitButton size="sm" pendingText="Saving…">
              Save Auto-Comment settings
            </SubmitButton>
          </form>

          {recentComments && recentComments.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600">Recent auto-comments</p>
              <div className="space-y-2">
                {recentComments.map((c) => {
                  const creatorUsername = (c.creators as unknown as { username: string } | null)?.username;
                  return (
                    <div key={c.id} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">
                          {creatorUsername ? `@${creatorUsername}` : "Unknown creator"} ·{" "}
                          <LocalDateTime iso={c.created_at as string} />
                        </span>
                        <span
                          className={
                            c.status === "posted"
                              ? "rounded-full bg-green-100 px-2 py-0.5 text-green-700"
                              : "rounded-full bg-red-100 px-2 py-0.5 text-red-700"
                          }
                        >
                          {c.status}
                        </span>
                      </div>
                      {c.status === "posted" ? (
                        <p className="mt-1 text-slate-700">&quot;{c.comment_text}&quot;</p>
                      ) : (
                        <p className="mt-1 text-red-600">{c.error_message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage cleanup</CardTitle>
          <CardDescription>
            Every AI-generated and manually-uploaded image (Generate post, Schedules, Image Generator) is
            saved permanently — nothing deletes it automatically, even after the draft using it is deleted
            or spun into a new version. This grows over time if left alone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={cleanupUnusedGeneratedImages}>
            <ConfirmSubmitButton
              variant="destructive"
              size="sm"
              pendingText="Cleaning up…"
              confirmMessage="Delete every stored image that no draft or schedule currently uses? Images still referenced anywhere are kept — only truly unused ones are removed. This can't be undone."
            >
              Clean up unused images
            </ConfirmSubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product photos (Shopee)</CardTitle>
          <CardDescription>
            Give a link and a real photo once — next time that same product&apos;s link shows up in a
            Topic field on Generate post, the saved photo is used automatically as the AI reference image.
            No re-upload needed, and it skips relying on the live auto-scrape (which Shopee&apos;s
            anti-bot system frequently blocks).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addProductPhoto} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="shopeeUrl" className="mb-1 block text-xs font-medium text-slate-600">
                  Shopee link
                </Label>
                <Input id="shopeeUrl" type="text" name="shopeeUrl" placeholder="https://s.shopee.com.my/..." />
              </div>
              <div>
                <Label htmlFor="photo" className="mb-1 block text-xs font-medium text-slate-600">
                  Real product photo
                </Label>
                <Input id="photo" type="file" name="photo" accept="image/*" className="py-1.5" />
              </div>
            </div>
            <SubmitButton size="sm" pendingText="Saving…">
              Save product photo
            </SubmitButton>
          </form>

          {productPhotos && productPhotos.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600">Saved product photos</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {productPhotos.map((p) => (
                  <div
                    key={p.id as string}
                    className="flex items-center gap-3 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image_url as string}
                      alt={(p.title as string | null) ?? "Product photo"}
                      className="h-12 w-12 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-700">{(p.title as string | null) ?? "Untitled product"}</p>
                      {p.source_url && (
                        <a
                          href={p.source_url as string}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate block text-slate-400 hover:text-slate-600"
                        >
                          {p.source_url as string}
                        </a>
                      )}
                    </div>
                    <form action={deleteProductPhoto}>
                      <input type="hidden" name="id" value={p.id as string} />
                      <ConfirmSubmitButton
                        variant="destructive"
                        size="sm"
                        pendingText="Deleting…"
                        confirmMessage="Delete this saved product photo? Generate post will fall back to auto-scraping (or AI generation) for this product next time."
                      >
                        Delete
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
