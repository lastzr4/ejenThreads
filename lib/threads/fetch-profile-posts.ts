import { ThreadsApiError } from "./publish";

// Official Meta Threads API — GET /profile_posts. Deliberately separate from
// lib/threads/scraper.ts (Playwright, reads public pages, produces a
// URL-shortcode-derived id that is NOT valid for reply_to_id) and from
// lib/threads/publish.ts (writes). This is the one supported, sanctioned way
// Auto-Comment gets a real Graph API media id for someone else's public
// post — the same id space GET /{user}/threads and threads_publish use —
// which is what reply_to_id actually requires.
//
// Docs: https://developers.facebook.com/docs/threads/reference/user
// "GET /profile_posts?username=..." — looks up any public Threads username
// (not just the connected account) and returns their recent posts with a
// real `id` field.

const GRAPH_BASE = "https://graph.threads.net/v1.0";

export interface OfficialThreadsPost {
  id: string;
  text: string | null;
  permalink: string | null;
  timestamp: string | null;
  username: string | null;
}

/**
 * Looks up a public Threads username's recent posts via the official API.
 * Throws ThreadsApiError on failure (private/nonexistent username, rate
 * limit, bad token) — callers should treat one creator's failure as
 * skippable rather than aborting an entire auto-comment cycle over it.
 */
export async function fetchProfilePosts(
  username: string,
  accessToken: string,
  limit = 10
): Promise<OfficialThreadsPost[]> {
  const url = new URL(`${GRAPH_BASE}/profile_posts`);
  url.searchParams.set("username", username.replace(/^@/, ""));
  url.searchParams.set("fields", "id,text,permalink,timestamp,username");
  url.searchParams.set("limit", String(Math.min(100, Math.max(1, limit))));
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) {
    throw new ThreadsApiError(
      data?.error?.message || data?.error_message || `Failed to look up @${username}'s posts`
    );
  }

  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    text: typeof row.text === "string" ? row.text : null,
    permalink: typeof row.permalink === "string" ? row.permalink : null,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
    username: typeof row.username === "string" ? row.username : null
  })).filter((p: OfficialThreadsPost) => p.id);
}
