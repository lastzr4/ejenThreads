import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-url";

function settingsRedirect(params: Record<string, string>) {
  const url = new URL("/dashboard/settings", getAppOrigin());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error_description") || searchParams.get("error");

  if (oauthError) {
    return settingsRedirect({ error: oauthError });
  }
  if (!code || !state) {
    return settingsRedirect({ error: "Missing code/state from Threads redirect" });
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // state was set to the user's id when we sent them to Meta's authorize
  // screen (see app/api/threads/oauth/start). If the current session
  // doesn't match, refuse rather than attaching a token to the wrong user.
  if (!user || user.id !== state) {
    return settingsRedirect({
      error: "Session mismatch — please log in and try connecting again"
    });
  }

  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirectUri = process.env.THREADS_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return settingsRedirect({
      error: "THREADS_APP_ID / THREADS_APP_SECRET / THREADS_REDIRECT_URI not configured"
    });
  }

  try {
    // Step 1: exchange the authorization code for a short-lived (1 hour) token.
    const shortLivedRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code
      })
    });
    const shortLivedData = await shortLivedRes.json();
    if (!shortLivedRes.ok || !shortLivedData.access_token) {
      throw new Error(
        shortLivedData?.error_message || shortLivedData?.error?.message || "Failed to exchange authorization code"
      );
    }

    const threadsUserId = String(shortLivedData.user_id);

    // Step 2: exchange the short-lived token for a long-lived one (60 days).
    const longLivedUrl = new URL("https://graph.threads.net/access_token");
    longLivedUrl.searchParams.set("grant_type", "th_exchange_token");
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("access_token", shortLivedData.access_token);

    const longLivedRes = await fetch(longLivedUrl.toString());
    const longLivedData = await longLivedRes.json();
    if (!longLivedRes.ok || !longLivedData.access_token) {
      throw new Error(
        longLivedData?.error_message || longLivedData?.error?.message || "Failed to get a long-lived token"
      );
    }

    const expiresAt = new Date(Date.now() + Number(longLivedData.expires_in ?? 0) * 1000).toISOString();

    const { error: dbError } = await supabase.from("user_settings").upsert({
      user_id: user.id,
      threads_api_user_id: threadsUserId,
      threads_api_access_token: longLivedData.access_token,
      threads_api_token_expires_at: expiresAt,
      threads_api_connected_at: new Date().toISOString()
    });

    if (dbError) {
      return settingsRedirect({ error: dbError.message });
    }

    return settingsRedirect({ message: "Threads API connected — auto-posting is ready to configure" });
  } catch (err) {
    return settingsRedirect({
      error: err instanceof Error ? err.message : "Threads API connection failed"
    });
  }
}
