// Official Meta Threads API client (Module 4 — auto-posting).
// Docs: https://developers.facebook.com/docs/threads
//
// This is deliberately separate from lib/threads/scraper.ts (Playwright,
// reads public/logged-in pages) — publishing uses graph.threads.net with a
// real OAuth access token, obtained via app/api/threads/oauth/*.

const GRAPH_BASE = "https://graph.threads.net/v1.0";

export class ThreadsApiError extends Error {}

/**
 * Long-lived tokens (60 days) can be refreshed any time they're at least
 * 24h old and not yet expired. Call this proactively (the cron tick does,
 * whenever a token is within REFRESH_MARGIN_MS of expiring) rather than
 * waiting for it to actually fail — once expired it can never be refreshed,
 * only re-obtained via the full OAuth flow again.
 */
export async function refreshLongLivedToken(
  accessToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new ThreadsApiError(data?.error_message || data?.error?.message || "Failed to refresh Threads token");
  }

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 0) * 1000).toISOString()
  };
}

interface CreateContainerOptions {
  threadsUserId: string;
  accessToken: string;
  text: string;
  replyToId?: string;
  imageUrl?: string;
  /**
   * Long-form text (up to ~10,000 characters per Meta's September 2025
   * announcement — see about.fb.com/news/2025/09/attach-text-threads-posts-
   * share-longer-perspectives) attached to this one post, shown as
   * expandable "See more" text. Meta's reference docs
   * (developers.facebook.com/docs/threads/reference/publishing) list a
   * `text_attachment` parameter of type "object" but don't publicly
   * document its exact sub-fields at the time this was written — sent here
   * as a JSON-encoded `{ text: "..." }` object, following the same
   * convention Graph API uses for its other object-typed params (e.g.
   * `poll_attachment`) in form-encoded requests. If Meta's actual shape
   * differs, Threads will reject the container creation call; see the
   * catch-and-retry-without-it fallback below so a schema mismatch loses
   * only the long-form attachment, not the whole post.
   */
  textAttachment?: string;
}

async function createContainer({
  threadsUserId,
  accessToken,
  text,
  replyToId,
  imageUrl,
  textAttachment
}: CreateContainerOptions): Promise<string> {
  const buildBody = (includeTextAttachment: boolean) => {
    const body = new URLSearchParams({
      media_type: imageUrl ? "IMAGE" : "TEXT",
      text,
      access_token: accessToken
    });
    if (replyToId) body.set("reply_to_id", replyToId);
    if (imageUrl) body.set("image_url", imageUrl);
    if (includeTextAttachment && textAttachment) {
      body.set("text_attachment", JSON.stringify({ text: textAttachment }));
    }
    return body;
  };

  const attempt = async (includeTextAttachment: boolean) => {
    const res = await fetch(`${GRAPH_BASE}/${threadsUserId}/threads`, {
      method: "POST",
      body: buildBody(includeTextAttachment)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  };

  let { ok, data } = await attempt(Boolean(textAttachment));

  // If including text_attachment caused the failure (unrecognized param,
  // wrong shape, etc.), retry once without it rather than losing the whole
  // post over an unconfirmed API detail.
  if (!ok && textAttachment) {
    ({ ok, data } = await attempt(false));
  }

  if (!ok || !data.id) {
    throw new ThreadsApiError(data?.error?.message || data?.error_message || "Failed to create Threads media container");
  }
  return data.id as string;
}

/**
 * Text-only containers are usually ready almost immediately, but Meta
 * recommends checking status rather than assuming so — poll briefly before
 * publishing rather than guessing with a blind delay.
 */
async function waitForContainerReady(containerId: string, accessToken: string): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = new URL(`${GRAPH_BASE}/${containerId}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.status === "FINISHED") return;
    if (data.status === "ERROR") {
      throw new ThreadsApiError(data.error_message || "Threads media container failed to process");
    }
    // IN_PROGRESS or EXPIRED (retry a couple of times regardless) — wait and check again.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  // Not fatal — text containers that don't report FINISHED in time usually
  // still publish fine. Proceed and let the publish call itself fail if not.
}

async function publishContainer(threadsUserId: string, accessToken: string, containerId: string): Promise<string> {
  const body = new URLSearchParams({ creation_id: containerId, access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/${threadsUserId}/threads_publish`, { method: "POST", body });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new ThreadsApiError(data?.error?.message || data?.error_message || "Failed to publish Threads post");
  }
  return data.id as string;
}

/**
 * Publishes one or more posts as a Threads thread: the first post stands
 * alone, and each subsequent post is chained as a reply to the previous
 * one's published id (reply_to_id) — this is how Threads represents a
 * multi-post "thread" from the same author.
 *
 * If imageUrl is given, only the FIRST post is published as an IMAGE
 * container (with that post's text as the caption) — any following thread
 * replies stay plain TEXT, since Threads represents a thread as a chain of
 * individually-typed posts rather than one post with a caption plus extra
 * text-only follow-ups.
 *
 * If textAttachment is given, it's attached to the FIRST post only (the
 * "single post, long-form" case — see generateStyledPost's role/postType
 * handling). Doesn't make sense combined with a multi-post thread, but
 * nothing stops a caller from doing both if they want to.
 *
 * Returns the id of the first (root) published post.
 */
export async function publishThreadPosts(
  threadsUserId: string,
  accessToken: string,
  posts: string[],
  imageUrl?: string | null,
  textAttachment?: string | null
): Promise<string> {
  if (posts.length === 0) {
    throw new ThreadsApiError("No post text to publish");
  }

  let previousPublishedId: string | undefined;
  let rootId: string | null = null;

  for (let i = 0; i < posts.length; i++) {
    const containerId = await createContainer({
      threadsUserId,
      accessToken,
      text: posts[i],
      replyToId: previousPublishedId,
      imageUrl: i === 0 ? imageUrl ?? undefined : undefined,
      textAttachment: i === 0 ? textAttachment ?? undefined : undefined
    });
    await waitForContainerReady(containerId, accessToken);
    const publishedId = await publishContainer(threadsUserId, accessToken, containerId);

    if (!rootId) rootId = publishedId;
    previousPublishedId = publishedId;
  }

  return rootId as string;
}
