import { chromium } from "playwright";

// Real-product-photo lookup for affiliate posts. Problem this solves: when a
// Shopee link is dropped in the Generate-post Topic field, Claude has no way
// to know what the actual product looks like (it can't open the link) — the
// AI-imagined image it used to describe from scratch was frequently
// unrelated to the real item. This fetches the ACTUAL product photo instead,
// which then gets passed to Gemini as a reference image (see
// lib/gemini/generate-image.ts's referenceImage param) so the generated
// image keeps the real product's appearance while still composing a fresh,
// engagement-optimized scene around it.
//
// ROOT CAUSE CONFIRMED (2026-07-29, via the diagnostic log line added
// earlier today): this isn't a parsing/selector problem — Shopee's
// anti-bot system detects the headless Playwright request (Railway's
// datacenter IP + automation fingerprint) and silently redirects it to
// `shopee.com.my/verify/traffic/error` (a "you look like a bot" challenge
// page) BEFORE the real product page ever loads. Every extraction strategy
// was then running against that generic challenge page, not the product —
// which is why the "largest image" fallback kept grabbing a generic Shopee
// promo banner (`deo.shopeemobile.com/.../assets/*.png`) with a title of
// "Shopee Malaysia | Free Shipping Across Malaysia", not the product photo.
//
// Two changes address this:
//   1. Detect the /verify/ redirect and bail out cleanly (null) instead of
//      running extraction against a challenge page and returning something
//      plausible-looking but wrong.
//   2. A few light, best-effort stealth tweaks (hiding the automation
//      fingerprint, more realistic headers) that may reduce how often the
//      block triggers — NOT a guaranteed fix; anti-bot detection is an
//      adversarial, moving target and a datacenter IP alone can be enough
//      to get flagged regardless of browser fingerprinting.
//
// Given that, treat this as best-effort and expect it to fail some/most of
// the time. The dependable path stays: the "Upload your own image" field on
// the Generate post form (also usable as a reference photo when "Generate
// image with AI" is checked too — see generate-actions.ts) — save the real
// product photo yourself and upload it, which always works regardless of
// what Shopee's bot detection decides to do.

export interface ShopeeProductInfo {
  imageBuffer: Buffer;
  imageMimeType: string;
  title: string | null;
}

const SHOPEE_URL_RE = /https?:\/\/(?:[\w-]+\.)?shopee\.(?:com\.my|com|sg|co\.id|co\.th|vn|ph|tw)[^\s]*/i;

/** True if the given text contains a Shopee link anywhere in it. */
export function containsShopeeLink(text: string | null | undefined): boolean {
  return Boolean(text && SHOPEE_URL_RE.test(text));
}

/** Pulls the first Shopee URL out of a longer text block (e.g. the Topic field). */
export function extractShopeeUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(SHOPEE_URL_RE);
  return match ? match[0] : null;
}

/**
 * Opens a Shopee product link in headless Chromium and pulls out the real
 * product photo + title. Returns null on ANY failure (short link didn't
 * resolve, page structure changed, no image found, download failed) — this
 * is always a soft fallback, never fatal to post generation; the caller
 * falls back to the old AI-imagined-image behavior.
 */
export async function fetchShopeeProductInfo(url: string): Promise<ShopeeProductInfo | null> {
  let browser;
  try {
    // --disable-blink-features=AutomationControlled hides one of the more
    // obvious automation signals Chromium exposes by default. Best-effort
    // only — see the module-level comment above for why this is not a
    // guaranteed bypass of Shopee's bot detection.
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-MY",
      timezoneId: "Asia/Kuala_Lumpur",
      extraHTTPHeaders: {
        "accept-language": "en-MY,en;q=0.9,ms-MY;q=0.8,ms;q=0.7"
      }
    });
    // Playwright's Chromium normally reports navigator.webdriver = true,
    // one of the most commonly checked automation signals — override it
    // before any page script runs, same technique used broadly for basic
    // headless-detection evasion. Best-effort only, see comment above.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Give client-side rendering/hydration a moment to finish injecting
    // meta tags and lazy-loading the main product image.
    await page.waitForTimeout(2000);

    // Shopee's anti-bot system can silently redirect to a "verify you're
    // not a bot" challenge page instead of the real product page (confirmed
    // happening in practice — see module comment). Running any extraction
    // strategy against that page returns something plausible-looking but
    // completely unrelated to the product, which is worse than just
    // failing — bail out cleanly here instead.
    if (/\/verify\//i.test(new URL(page.url()).pathname)) {
      console.error("[fetchShopeeProductInfo] blocked by Shopee anti-bot (redirected to a verify/challenge page):", page.url());
      return null;
    }

    const extracted = await page.evaluate(async () => {
      const looksLikeBrandingAsset = (src: string) => /logo|icon|favicon|badge|sprite/i.test(src);

      // Strategy 1: Shopee's own item-detail API, called same-origin (so it
      // carries the real cookies/referer this page already established —
      // far more likely to succeed than an external request would). Shopee
      // item URLs encode shopid/itemid as the two numbers in the path;
      // tried in both orders since which is which isn't confirmed.
      const pathNums = Array.from(location.pathname.matchAll(/(\d{5,})/g)).map((m) => m[1]);
      const apiAttempts: string[] = [];
      for (const [shopid, itemid] of [
        [pathNums[0], pathNums[1]],
        [pathNums[1], pathNums[0]]
      ]) {
        if (!shopid || !itemid) continue;
        try {
          const res = await fetch(`/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`, {
            headers: { accept: "application/json" }
          });
          apiAttempts.push(`shopid=${shopid}&itemid=${itemid} -> HTTP ${res.status}`);
          if (!res.ok) continue;
          const json = await res.json();
          const item = json?.data?.item ?? json?.item;
          const imageHash = item?.images?.[0] ?? item?.image;
          if (imageHash) {
            return {
              imageUrl: `https://cf.shopee.com.my/file/${imageHash}`,
              title: item?.name ?? document.title ?? null,
              strategy: "item-api",
              debug: apiAttempts
            };
          }
        } catch (e) {
          apiAttempts.push(`shopid=${shopid}&itemid=${itemid} -> threw ${e instanceof Error ? e.message : e}`);
        }
      }

      // Strategy 2: og:image meta tag, if this render actually has one and
      // it's not just Shopee's generic site-wide logo/banner.
      const og = (name: string) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ?? null;
      const ogImage = og("og:image");
      const ogTitle = og("og:title") || document.title || null;
      if (ogImage && !looksLikeBrandingAsset(ogImage)) {
        return { imageUrl: ogImage, title: ogTitle, strategy: "og:image", debug: apiAttempts };
      }

      // Strategy 3: largest visible <img> on the page, excluding anything
      // that looks like a logo/icon/badge rather than a product photo.
      const images = Array.from(document.querySelectorAll("img"))
        .filter((img) => img.naturalWidth > 200 && img.naturalHeight > 200 && !looksLikeBrandingAsset(img.src))
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);

      return images[0]
        ? { imageUrl: images[0].src, title: ogTitle, strategy: "largest-img", debug: apiAttempts }
        : { imageUrl: null, title: ogTitle, strategy: "none", debug: apiAttempts };
    });

    const finalUrl = page.url();
    await browser.close();
    browser = undefined;

    // Logged unconditionally (not just on failure) so the NEXT wrong-image
    // report can be diagnosed directly from these lines — which strategy
    // won, what URL it picked, what the item-API calls actually returned —
    // instead of guessing again with no feedback loop.
    console.log(
      "[fetchShopeeProductInfo] resolvedUrl=%s strategy=%s imageUrl=%s title=%s apiAttempts=%j",
      finalUrl,
      extracted?.strategy,
      extracted?.imageUrl,
      extracted?.title,
      extracted?.debug
    );

    if (!extracted?.imageUrl) {
      console.error("[fetchShopeeProductInfo] no product image found on page:", url);
      return null;
    }

    const imageRes = await fetch(extracted.imageUrl);
    if (!imageRes.ok) {
      console.error("[fetchShopeeProductInfo] failed to download product image:", extracted.imageUrl, imageRes.status);
      return null;
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const mimeType = imageRes.headers.get("content-type") || "image/jpeg";

    return { imageBuffer: buffer, imageMimeType: mimeType, title: extracted.title };
  } catch (err) {
    console.error("[fetchShopeeProductInfo] failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
