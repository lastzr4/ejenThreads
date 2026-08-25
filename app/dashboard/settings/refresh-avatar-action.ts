"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchThreadsProfile } from "@/lib/threads/publish";

/**
 * Meta's Threads/Instagram CDN profile-picture URLs are signed and
 * time-limited (an `oe=` expiry param) — they stop loading days/weeks
 * after being fetched, long before the actual API access token expires.
 * Rather than making the user go through a full OAuth reconnect just to
 * get a fresh picture URL, this re-calls the same profile lookup used at
 * connect time using the access token already on file (still valid — only
 * the CDN link went stale) and saves the fresh URL. Called automatically
 * by AvatarImage the moment an <img> actually fails to load, so a stale
 * photo self-heals without the user having to do anything.
 *
 * Returns the fresh URL on success, or null if not connected / the lookup
 * failed (AvatarImage falls back to the "?" placeholder in that case).
 */
export async function refreshThreadsAvatar(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: settings } = await supabase
    .from("user_settings")
    .select("threads_api_user_id, threads_api_access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!settings?.threads_api_user_id || !settings?.threads_api_access_token) return null;

  const profile = await fetchThreadsProfile(settings.threads_api_user_id, settings.threads_api_access_token);
  if (!profile.profilePictureUrl) return null;

  await supabase
    .from("user_settings")
    .update({
      threads_api_username: profile.username,
      threads_api_name: profile.name,
      threads_api_profile_picture_url: profile.profilePictureUrl
    })
    .eq("user_id", user.id);

  return profile.profilePictureUrl;
}
