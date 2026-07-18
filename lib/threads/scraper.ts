// Self-hosted Threads scraper using Playwright (headless Chromium).
//
// This replaces the earlier RapidAPI-based client — every "Threads scraper"
// listing we tried on RapidAPI was dead/unreachable. Since this app runs as
// a persistent Node process on Railway (not a serverless function), running
// a real headless browser here is workable: Railway's Dockerfile build
// (see /Dockerfile) is based on mcr.microsoft.com/playwright, which ships
// Chromium + every system library it needs preinstalled.
//
// IMPORTANT — this is best-effort and UNVERIFIED against a live page:
// Threads' public profile pages are a React app with class names that are
// typically hashed/obfuscated, so scraping by CSS class is fragile. This
// client tries two strategies, in order:
//   1. Look for a server-embedded JSON state blob in a <script> tag
//      (common in React/Next-style SSR apps) — if found, this is far more
//      reliable than DOM scraping since it's structured data.
//   2. Fall back to DOM scraping using semantic/structural selectors
//      (<article> elements, <time datetime> for timestamps) that are more
//      likely to survive a redesign than utility-class selectors.
//
// If neither strategy finds posts, the full page HTML is preserved in the
// `raw` field (and gets stored in `scraped_threads.raw_data`) specifically
// so you can inspect real markup and tell me what to fix — the equivalent
// of what raw_data already did for the RapidAPI attempt.
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
 * DOM-scraping fallback: pull post-like content out of <article> elements
 * (or elements with role="article"), which is the most likely stable
 * structural marker to survive a redesign, even if class names change.
 */
async function extractFromDom(page: import("playwright").Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('article, [role="article"]')
    );

    return nodes.map((node) => {
      const text = (node as HTMLElement).innerText?.trim() ?? "";
      const timeEl = node.querySelector("time[datetime]");
      const linkEl = node.querySelector('a[href*="/post/"]') as HTMLAnchorElement | null;
      const img = node.querySelector("img[src]") as HTMLImageElement | null;

      // Engagement counts aren't reliably labeled without inspecting real
      // markup — leaving these at 0 here is intentional; likes/replies/
      // reposts will need real selectors once you can see the actual DOM
      // (e.g. via aria-label="Like", aria-label="Reply" buttons).
      return {
        text,
        url: linkEl?.href ?? null,
        created_at: timeEl?.getAttribute("datetime") ?? null,
        media: img?.src ? [img.src] : []
      };
    });
  });
}

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/**
 * Fetch recent posts for a Threads username by rendering their public
 * profile page in headless Chromium. Returns normalized posts plus
 * whatever raw data we extracted (stored in `scraped_threads.raw_data`
 * for reprocessing/debugging).
 */
export async function fetchCreatorPosts(username: string): Promise<FetchCreatorPostsResult> {
  const handle = username.trim().replace(/^@/, "");
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
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

    const embeddedJson = await extractEmbeddedJson(page);
    if (embeddedJson) {
      const list = findFirstPostArray(embeddedJson);
      if (list.length > 0) {
        return { posts: list.map(normalizeThreadsPost), raw: embeddedJson };
      }
    }

    const domPosts = await extractFromDom(page);
    if (domPosts.length > 0) {
      return { posts: domPosts.map(normalizeThreadsPost), raw: domPosts };
    }

    // Nothing found by either strategy. page.content() returns from <head>,
    // and Threads' <head> is large enough (inline CSS variables, meta tags)
    // to blow past a reasonable size cap before ever reaching <body> — so
    // capture body text/HTML specifically instead, which is what actually
    // shows whether there's a login wall vs. posts our selectors missed.
    const diagnostic = await page.evaluate(() => {
      const body = document.body;
      return {
        bodyText: body?.innerText?.slice(0, 6_000) ?? null,
        bodyHtml: body?.innerHTML?.slice(0, 15_000) ?? null,
        title: document.title
      };
    });
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
