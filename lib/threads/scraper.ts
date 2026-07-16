// Generic RapidAPI-style Threads scraper client.
//
// RapidAPI listings for "Threads scraper" vary in exact endpoint path and
// response shape, so this client is deliberately provider-agnostic:
//   - THREADS_SCRAPER_BASE_URL: the full endpoint URL for "get user posts"
//     from whichever listing you subscribe to (copy it from the RapidAPI
//     "Test Endpoint" panel, e.g.
//     https://<some-host>.p.rapidapi.com/api/user/posts).
//   - THREADS_SCRAPER_HOST: the value RapidAPI shows as `X-RapidAPI-Host`
//     for that listing (e.g. some-host.p.rapidapi.com).
//   - THREADS_SCRAPER_API_KEY: your RapidAPI key (same key works across
//     every RapidAPI-hosted API you're subscribed to).
//
// normalizeThreadsPost() below has fallback lookups for the field names
// that are most common across these listings, but you WILL likely need to
// tweak it once you see your specific provider's real response — the full
// raw payload is preserved in `scraped_threads.raw_data` for exactly this
// reason, so nothing is lost even if a field mapping is off at first.

export interface NormalizedThreadsPost {
  platformPostId: string | null;
  postUrl: string | null;
  contentText: string | null;
  mediaUrls: string[];
  likeCount: number;
  replyCount: number;
  repostCount: number;
  shareCount: number;
  isReply: boolean;
  parentPostId: string | null;
  publishedAt: string | null;
  raw: unknown;
}

export interface FetchCreatorPostsResult {
  posts: NormalizedThreadsPost[];
  raw: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/** Pull the first defined value out of a set of possible field names. */
function pick(obj: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return undefined;
}

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractMediaUrls(post: Record<string, any>): string[] {
  const media = pick(post, ["media", "media_urls", "images", "attachments"]);
  if (!media) return [];
  if (Array.isArray(media)) {
    return media
      .map((m) => (typeof m === "string" ? m : pick(m, ["url", "src", "image_url"])))
      .filter(Boolean);
  }
  return [];
}

export function normalizeThreadsPost(post: Record<string, any>): NormalizedThreadsPost {
  return {
    platformPostId: pick(post, ["id", "post_id", "pk", "code"]) ?? null,
    postUrl: pick(post, ["url", "post_url", "permalink"]) ?? null,
    contentText: pick(post, ["text", "content", "caption", "body"]) ?? null,
    mediaUrls: extractMediaUrls(post),
    likeCount: toNumber(pick(post, ["likes", "like_count", "likeCount"])),
    replyCount: toNumber(pick(post, ["replies", "reply_count", "replyCount"])),
    repostCount: toNumber(pick(post, ["reposts", "repost_count", "repostCount"])),
    shareCount: toNumber(pick(post, ["shares", "share_count", "shareCount"])),
    isReply: Boolean(pick(post, ["is_reply", "isReply"])) ?? false,
    parentPostId: pick(post, ["parent_id", "parent_post_id", "reply_to"]) ?? null,
    publishedAt: pick(post, ["created_at", "createdAt", "published_at", "timestamp"]) ?? null,
    raw: post
  };
}

/**
 * Fetch a single page of recent posts for a Threads username via the
 * configured RapidAPI listing. Returns normalized posts plus the raw
 * response (stored in `scraped_threads.raw_data` for reprocessing).
 */
export async function fetchCreatorPosts(username: string): Promise<FetchCreatorPostsResult> {
  const baseUrl = requireEnv("THREADS_SCRAPER_BASE_URL");
  const host = requireEnv("THREADS_SCRAPER_HOST");
  const apiKey = requireEnv("THREADS_SCRAPER_API_KEY");

  const url = new URL(baseUrl);
  url.searchParams.set("username", username);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": host
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Scraper request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const raw = await response.json();

  // Most listings return either `{ posts: [...] }`, `{ data: [...] }`, or a
  // bare array. Handle all three.
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.posts)
      ? raw.posts
      : Array.isArray(raw?.data)
        ? raw.data
        : [];

  return {
    posts: list.map(normalizeThreadsPost),
    raw
  };
}
