import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-url";

// Kicks off the Official Threads API OAuth flow (Module 4 — auto-posting).
// This is a completely separate credential from the Playwright scraping
// session (Settings -> "Threads session", used for Module 1 reading) — this
// one is the real, sanctioned way to publish posts on the user's behalf.
export async function GET(_request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", getAppOrigin()));
  }

  const appId = process.env.THREADS_APP_ID;
  const redirectUri = process.env.THREADS_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings?error=${encodeURIComponent(
          "THREADS_APP_ID / THREADS_REDIRECT_URI not configured — see README Module 4 setup"
        )}`,
        getAppOrigin()
      )
    );
  }

  // state carries the logged-in user's id through Meta's redirect so the
  // callback route knows which app user to attach the resulting token to.
  // Meta echoes this back verbatim and unmodified; it cannot be forged into
  // a valid authorization without the user genuinely approving in Meta's
  // own login window, so this is a standard, safe use of `state` here.
  const authorizeUrl = new URL("https://threads.net/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", appId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  // threads_manage_replies is required for any POST to a reply endpoint —
  // that's exactly what publishing a thread (or the long-form comment-chain
  // fallback) does via reply_to_id. Without it, Meta returns "Application
  // does not have permission for this action" the moment a second
  // (reply) post is attempted — confirmed as the actual root cause behind
  // every failed multi-post thread in this app so far (single, standalone
  // posts worked fine since they never call a reply endpoint).
  authorizeUrl.searchParams.set(
    "scope",
    "threads_basic,threads_content_publish,threads_manage_replies"
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", user.id);

  return NextResponse.redirect(authorizeUrl);
}
