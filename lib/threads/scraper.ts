// Self-hosted Threads scraper using Playwright (headless Chromium).
//
// This replaces the earlier RapidAPI-based client — every "Threads scraper"
// listing we tried on RapidAPI was dead/unreachable. Since this app runs as
// a persistent Node process on Railway (not a serverless function), running
// a real headless browser here is workable: Railway's Dockerfile build
// (see /Dockerfile) is based on mcr.microsoft.com/playwright, which ships
// Chromium + every system library it needs preinstalled.
//
// Confirmed against a live page (2026-07-18, @ed.puteri): Threads renders a
// handful of recent public posts server-side, then shows a "Log in to see
// more" wall — no <article>/role="article" markup (that was an early
// guess that found nothing). What actually works: each post has a small
// byline link back to the author's own profile (href="/@handle"); walking
// up from that link to the nearest ancestor containing a <time> element
// gives the real post container.
//
// Second gap found later (2026-07-22): Threads also lazy-loads posts via
// infinite scroll, so even a real live page only exposes ~5 posts in the
// initial render regardless of login state — scrollToLoadMore() (below)
// scrolls repeatedly before extraction runs, which is what actually
// surfaces more history, separately from whether a session is attached.
//
// Two strategies, in order:
//   1. Look for a server-embedded JSON state blob in a <script> tag — if
//      found, this is far more reliable than DOM scraping since it's
//      structured data. Hasn't been confirmed present on Threads yet, but
//      cheap to check first.
//   2. DOM scraping via the byline+<time> pattern described above.
//
// Known gap: engagement counts (likes/replies/reposts) aren't mapped yet —
// the numbers render as bare digits with no accessible label tying a
// number to what it counts, at least not in a way this pass captures.
//
// If neither strategy finds posts, bodyText plus outerHTML samples around
// any byline links are preserved in the `raw` field (stored in
// `scraped_threads.raw_data` / `creators.last_fetch_debug`) so real markup
// can be inspected without another blind round.
//
// Legal note: Meta's Threads Terms of Service discourage automated
// scraping without permission. This is a common practice for personal/
// small-scale analysis tools like this one, but it is a grey area, not
// something officially sanctioned — keep request volume low and be aware
// your IP/account could get rate-limited or blocked.

import { chromium, type Browser } from "playwright";

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

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  // Handles compact formats some UIs render, e.g. "12.3K", "1.2M".
  const match = value.trim().match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!match) {
    const n = parseInt(value.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  const base = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : 1;
  return Math.round(base * multiplier);
}

/** Pull the first defined value out of a set of possible field names. */
function pick(obj: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return undefined;
}

/** Threads post URLs look like `.../@handle/post/CODE` — pull CODE out as a fallback id. */
function extractPostIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/post\/([^/?#]+)/);
  return match ? match[1] : null;
}

export function normalizeThreadsPost(post: Record<string, any>): NormalizedThreadsPost {
  const media = pick(post, ["media", "media_urls", "images", "attachments"]);
  const mediaUrls: string[] = Array.isArray(media)
    ? media
        .map((m) => (typeof m === "string" ? m : pick(m, ["url", "src", "image_url"])))
        .filter(Boolean)
    : [];

  const postUrl = pick(post, ["url", "post_url", "permalink"]) ?? null;
  // DOM-scraped posts (see extractFromDom) have no explicit id field, only
  // a URL — derive one so these rows don't get silently dropped before
  // insert (scraped_threads requires platform_post_id).
  const platformPostId = pick(post, ["id", "post_id", "pk", "code"]) ?? extractPostIdFromUrl(postUrl);

  return {
    platformPostId: platformPostId ?? null,
    postUrl,
    contentText: pick(post, ["text", "content", "caption", "body"]) ?? null,
    mediaUrls,
    likeCount: toNumber(pick(post, ["likes", "like_count", "likeCount"])),
    replyCount: toNumber(pick(post, ["replies", "reply_count", "replyCount"])),
    repostCount: toNumber(pick(post, ["reposts", "repost_count", "repostCount"])),
    shareCount: toNumber(pick(post, ["shares", "share_count", "shareCount"])),
    isReply: Boolean(pick(post, ["is_reply", "isReply"])),
    parentPostId: pick(post, ["parent_id", "parent_post_id", "reply_to"]) ?? null,
    publishedAt: pick(post, ["created_at", "createdAt", "published_at", "timestamp"]) ?? null,
    raw: post
  };
}

/**
 * Look for a JSON state blob embedded in a <script> tag. Tries a handful of
 * common patterns; returns the parsed object or null if nothing matched.
 */
async function extractEmbeddedJson(page: import("playwright").Page): Promise<any | null> {
  return page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));

    for (const script of scripts) {
      const id = script.getAttribute("id") ?? "";
      const text = script.textContent ?? "";

      // Next.js-style SSR payload.
      if (id === "__NEXT_DATA__" && text.trim()) {
        try {
          return JSON.parse(text);
        } catch {
          // fall through to try other scripts
        }
      }

      // Generic "window.__SOMETHING__ = {...}" assignment.
      const match = text.match(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]*\});?/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch {
          // fall through
        }
      }
    }

    return null;
  });
}

/**
 * DOM-scraping fallback. Confirmed against a live page (2026-07-18): Threads
 * does NOT use <article>/role="article" — that guess found nothing. What
 * does work: each post has a small byline link back to the author's own
 * profile (e.g. `href="/@ed.puteri"`), repeated once per post, distinct
 * from the one-off profile header. We find every such byline and walk up
 * to the nearest ancestor that also contains a timestamp <time> element —
 * that ancestor is the post container.
 */
async function extractFromDom(page: import("playwright").Page, handle: string): Promise<Record<string, any>[]> {
  return page.evaluate((targetHandle: string) => {
    const hrefSuffix = `/@${targetHandle}`.toLowerCase();
    const bylineLinks = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const href = (a as HTMLAnchorElement).getAttribute("href")?.toLowerCase() ?? "";
      return href === hrefSuffix || href === hrefSuffix + "/";
    });

    const seen = new Set<Element>();
    const posts: Record<string, any>[] = [];

    for (const link of bylineLinks) {
      // Walk up a handful of levels looking for a container that has a
      // <time> element — that's the actual post card, not just the byline.
      let container: HTMLElement | null = link.parentElement;
      let timeEl: Element | null = null;
      for (let depth = 0; depth < 8 && container; depth++) {
        timeEl = container.querySelector("time");
        if (timeEl) break;
        container = container.parentElement;
      }
      if (!container || !timeEl || seen.has(container)) continue;
      seen.add(container);

      // Raw innerText includes the byline/timestamp/engagement-count noise
      // around the actual post text — strip leading username/date lines
      // and trailing bare-number lines (confirmed structure from a live
      // page: username, [optional community tag], relative time, text,
      // [Translate], count, count, ...).
      const rawLines = ((container as HTMLElement).innerText ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const dateLike = /^\d+[dhwms]$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/i;
      while (
        rawLines.length > 0 &&
        (rawLines[0].toLowerCase() === targetHandle.toLowerCase() || dateLike.test(rawLines[0]))
      ) {
        rawLines.shift();
      }
      while (
        rawLines.length > 0 &&
        (/^\d+$/.test(rawLines[rawLines.length - 1]) ||
          rawLines[rawLines.length - 1].toLowerCase() === "translate")
      ) {
        rawLines.pop();
      }
      const text = rawLines.join(" ").trim();

      // Post URL: any link inside the container pointing at a specific
      // post (Threads post URLs contain "/post/").
      const postLink = container.querySelector('a[href*="/post/"]') as HTMLAnchorElement | null;
      const img = container.querySelector('img[src]:not([src*="profile"])') as HTMLImageElement | null;

      posts.push({
        text,
        url: postLink?.href ?? null,
        created_at: timeEl.getAttribute("datetime") ?? timeEl.getAttribute("title") ?? null,
        created_at_relative: (timeEl as HTMLElement).innerText ?? null,
        media: img?.src ? [img.src] : []
        // Engagement counts (likes/replies/reposts) are still not mapped
        // here — Threads doesn't appear to label them with accessible text
        // adjacent to the number in a way this pass captures. That's the
        // next thing to fix once raw_data from a real successful row can
        // be inspected.
      });
    }

    return posts;
  }, handle);
}

/**
 * Threads loads posts via infinite scroll — the initial page render only
 * contains a handful (confirmed: as few as ~5), with more fetched in as
 * you scroll. Without this, fetchCreatorPosts silently capped out at
 * whatever rendered first regardless of login state, which looked like a
 * login-wall limit but wasn't — scroll down repeatedly, counting byline
 * links after each scroll, and stop once two consecutive scrolls bring in
 * no new ones (real end of available history, or hit the login wall for
 * anonymous sessions).
 */
async function scrollToLoadMore(page: import("playwright").Page, handle: string, maxScrolls = 12): Promise<void> {
  const countBylineLinks = () =>
    page.evaluate((targetHandle: string) => {
      const hrefSuffix = `/@${targetHandle}`.toLowerCase();
      return Array.from(document.querySelectorAll("a[href]")).filter((a) => {
        const href = (a as HTMLAnchorElement).getAttribute("href")?.toLowerCase() ?? "";
        return href === hrefSuffix || href === hrefSuffix + "/";
      }).length;
    }, handle);

  let previousCount = await countBylineLinks();
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const count = await countBylineLinks();
    if (count <= previousCount) {
      stableRounds++;
      if (stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }
    previousCount = count;
  }
}

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/**
 * Optional fallback: a logged-in Threads session via base64-encoded env
 * var, for setups that prefer Railway Variables over the in-app Settings
 * page (app/dashboard/settings). The primary path is now passing
 * sessionState directly into fetchCreatorPosts() — see below — loaded by
 * the caller from `user_settings.threads_session_state` in Supabase.
 */
function loadSessionStateFromEnv(): Record<string, unknown> | undefined {
  const b64 = process.env.THREADS_SESSION_STATE_B64;
  if (!b64) return undefined;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  } catch {
    console.warn("THREADS_SESSION_STATE_B64 is set but failed to parse — scraping anonymously.");
    return undefined;
  }
}

/**
 * Fetch recent posts for a Threads username by rendering their public
 * profile page in headless Chromium. Returns normalized posts plus
 * whatever raw data we extracted (stored in `scraped_threads.raw_data`
 * for reprocessing/debugging).
 *
 * @param sessionState Optional captured Threads/Instagram session
 *   (Playwright storageState shape — an object with `cookies`/`origins`),
 *   typically loaded by the caller from `user_settings.threads_session_state`
 *   (see app/dashboard/settings). When present, scraping sees the full
 *   logged-in view instead of the ~3-4 post anonymous preview. Using this
 *   ties scraping to a real account and runs it from this server's IP
 *   rather than the account owner's — Meta may treat that as suspicious.
 *   Falls back to THREADS_SESSION_STATE_B64 env var, then to anonymous
 *   scraping, if not provided.
 */
export async function fetchCreatorPosts(
  username: string,
  sessionState?: Record<string, unknown> | null
): Promise<FetchCreatorPostsResult> {
  const handle = username.trim().replace(/^@/, "");
  const browser = await getBrowser();
  const storageState = sessionState ?? loadSessionStateFromEnv();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    // Cast: Playwright's storageState option type is stricter than the
    // plain object we get back from decoding JSON, but the shape (parsed
    // output of context.storageState()) matches exactly at runtime.
    ...(storageState ? { storageState: storageState as any } : {})
  });
  const page = await context.newPage();

  try {
    await page.goto(`https://www.threads.net/@${handle}`, {
      waitUntil: "networkidle",
      timeout: 30_000
    });

    // Give client-side rendering a moment to settle for pages that don't
    // fully resolve on "networkidle".
    await page.waitForTimeout(1500);

    // Scroll to trigger Threads' infinite-load before extracting anything —
    // otherwise only the first render's handful of posts ever gets seen.
    await scrollToLoadMore(page, handle);

    const embeddedJson = await extractEmbeddedJson(page);
    if (embeddedJson) {
      const list = findFirstPostArray(embeddedJson);
      if (list.length > 0) {
        return { posts: list.map(normalizeThreadsPost), raw: embeddedJson };
      }
    }

    const domPosts = await extractFromDom(page, handle);
    if (domPosts.length > 0) {
      return { posts: domPosts.map(normalizeThreadsPost), raw: domPosts };
    }

    // Nothing found by either strategy. Capture bodyText (cheap sanity
    // check — confirms real content vs. a login wall) plus outerHTML
    // samples around any byline links matching this handle, so the actual
    // post container markup is visible without wasting the size cap on
    // <head> boilerplate or preloaded <script> JSON payloads.
    const diagnostic = await page.evaluate((targetHandle: string) => {
      const hrefSuffix = `/@${targetHandle}`.toLowerCase();
      const bylineLinks = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
        const href = (a as HTMLAnchorElement).getAttribute("href")?.toLowerCase() ?? "";
        return href === hrefSuffix || href === hrefSuffix + "/";
      });

      const samples = bylineLinks.slice(0, 4).map((link) => {
        const p1 = link.parentElement;
        const p2 = p1?.parentElement;
        const p3 = p2?.parentElement;
        return {
          linkHtml: link.outerHTML?.slice(0, 300),
          ancestor3Html: p3?.outerHTML?.slice(0, 4_000) ?? null
        };
      });

      return {
        bodyText: document.body?.innerText?.slice(0, 4_000) ?? null,
        title: document.title,
        bylineLinkCount: bylineLinks.length,
        samples
      };
    }, handle);
    return { posts: [], raw: { note: "No posts extracted", ...diagnostic } };
  } finally {
    await context.close();
  }
}

/** Recursively search a parsed JSON blob for the first array that looks like a list of posts. */
function findFirstPostArray(value: unknown, depth = 0): any[] {
  if (depth > 6 || value === null || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    const looksLikePosts = value.some(
      (item) => item && typeof item === "object" && ("text" in item || "caption" in item || "id" in item)
    );
    if (looksLikePosts) return value;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    const found = findFirstPostArray((value as Record<string, unknown>)[key], depth + 1);
    if (found.length > 0) return found;
  }

  return [];
}

/** Call at server shutdown if you ever run this in a long-lived worker process. */
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
